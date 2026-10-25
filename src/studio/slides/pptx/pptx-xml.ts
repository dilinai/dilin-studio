// 组件版 pptx 导出 · 出档后补 XML（平滑切换／幻灯片背景填充／渐层／预设形状参数·pptxgenjs 没开这些口）
//
//   pptxgenjs 写完 ⇒ JSZip 打开 ppt/slides/slideN.xml ⇒ 按物件名称（objectName＝组件编号）找到那个 <p:sp> 改：
//     useBgFill   ＝ <p:sp useBgFill="1">（PowerPoint「投影片背景填滿」）·摘掉原填色
//     gradFill    ＝ 原填色换成 <a:gradFill>（线性·各色标带透明度）
//     avLst       ＝ 预设形状的调整值（圆环厚度、对话框尾巴）
//   换页切换：</p:sld> 前补 <p:transition>；平滑＝mc:AlternateContent（Choice p159:morph·Fallback 淡化·与 PowerPoint 自己写的同形）。
//   纯字串函数（单测直接喂 XML）·客户端安全。

import type { LinearGradient, PageTransition } from '../kit/components/types'
import { bookmarkListXml, buildTimingXml, type ShapeRef, type SlideMediaSpec, type TimelineItem, type TimingStats } from './pptx-timing'

export type ShapeXmlPatch = { useBgFill?: boolean; gradFill?: string; avLst?: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 方向 ⇒ OOXML dir（＝新页移动的方向：从右边进来＝往左动＝l） */
const DIR: Record<string, string> = { right: 'l', left: 'r', down: 'u', up: 'd' }

const spd = (ms: number) => (ms >= 1000 ? 'slow' : ms >= 600 ? 'med' : 'fast')

/** 一页的 <p:transition>（none ⇒ 空串） */
export function transitionXml(tr: PageTransition | undefined | null): string {
  if (!tr || tr.type === 'none') return ''
  const ms = Math.round(tr.durationMs)
  const dir = DIR[tr.direction ?? 'right'] ?? 'l'
  // p14:dur＝精确毫秒（PowerPoint 2010+）·spd 给旧版退路
  const p14 = 'xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"'
  const body = (inner: string) => `<p:transition spd="${spd(ms)}" ${p14} p14:dur="${ms}">${inner}</p:transition>`
  const plain = (inner: string) => `<p:transition spd="${spd(ms)}">${inner}</p:transition>`
  const alt = (choiceNs: string, req: string, choice: string, fallback: string) =>
    `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice ${choiceNs} Requires="${req}">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`
  switch (tr.type) {
    case 'morph':
      return alt('xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main"', 'p159', body('<p159:morph option="byObject"/>'), plain('<p:fade/>'))
    case 'fade': return alt(p14, 'p14', body('<p:fade/>'), plain('<p:fade/>'))
    case 'push': return alt(p14, 'p14', body(`<p:push dir="${dir}"/>`), plain(`<p:push dir="${dir}"/>`))
    case 'wipe': return alt(p14, 'p14', body(`<p:wipe dir="${dir}"/>`), plain(`<p:wipe dir="${dir}"/>`))
    case 'zoom': return alt(p14, 'p14', body('<p:zoom/>'), plain('<p:zoom/>'))
    default: return ''
  }
}

/** 颜色 #RRGGBB(AA) ⇒ <a:srgbClr>（带透明度） */
function srgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim())
  if (!m) return '<a:srgbClr val="000000"/>'
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1
  return a >= 1 ? `<a:srgbClr val="${m[1].toUpperCase()}"/>` : `<a:srgbClr val="${m[1].toUpperCase()}"><a:alpha val="${Math.round(a * 100000)}"/></a:srgbClr>`
}

/** 线性渐层 ⇒ <a:gradFill>（resolve＝把 theme: 记号解成 #hex） */
export function gradFillXml(g: LinearGradient, resolve: (c: string) => string): string {
  const stops = g.stops.map((s) => `<a:gs pos="${Math.round(s.pos * 1000)}">${srgb(resolve(s.color))}</a:gs>`).join('')
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${Math.round(((g.angle % 360) + 360) % 360 * 60000)}" scaled="0"/></a:gradFill>`
}

const FILL_RE = /<a:noFill\/>|<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:gradFill[\s\S]*?<\/a:gradFill>/

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/**
 * 物件编号重排：pptxgenjs 的 cNvPr id 各种物件各算各的（形状＝序号＋2、影片＝关系号＋2、表格＝表序×页号＋1）会撞号；
 * 动画按编号（spid）指物件 ⇒ 先按文件顺序重排成不重复（根组＝1·其余 2 起）·回 名字 ⇒ 物件 对照。
 */
export function renumberShapeIds(xml: string): { xml: string; byName: Map<string, ShapeRef[]> } {
  const byName = new Map<string, ShapeRef[]>()
  let n = 0
  const out = xml.replace(/<p:cNvPr id="\d+"( name="([^"]*)")?/g, (m, nameAttr: string | undefined, name: string | undefined, offset: number) => {
    n++
    if (n > 1 && name !== undefined) {
      const head = xml.slice(Math.max(0, offset - 400), offset)
      const k = /<p:(sp|pic|graphicFrame|cxnSp|grpSp)[\s>](?![\s\S]*<p:(?:sp|pic|graphicFrame|cxnSp|grpSp)[\s>])/.exec(head)
      const kind: ShapeRef['kind'] = k?.[1] === 'sp' ? 'sp' : k?.[1] === 'pic' ? 'pic' : k?.[1] === 'graphicFrame' ? 'graphicFrame' : 'other'
      const key = unesc(name)
      const list = byName.get(key) ?? []
      list.push({ spid: n, kind })
      byName.set(key, list)
    }
    return `<p:cNvPr id="${n}"${nameAttr ?? ''}`
  })
  return { xml: out, byName }
}

/* ------------------------------------------------------------------ */
/* 嵌入影片                                                     */
/* ------------------------------------------------------------------ */

/** 影片档认格式（先看档头·再看 content-type）：mp4／mov 可嵌；webm 等 PowerPoint 放不了 ⇒ null */
export function videoFormatOf(head: Uint8Array, mime: string): { ext: 'mp4' | 'mov'; mime: string } | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...Array.from(head.subarray(a, b)))
  if (head.length >= 12 && ascii(4, 8) === 'ftyp') {
    return ascii(8, 12) === 'qt  ' ? { ext: 'mov', mime: 'video/quicktime' } : { ext: 'mp4', mime: 'video/mp4' }
  }
  // 老式 mov（没 ftyp·第一个盒子就是 moov／mdat／wide）
  if (head.length >= 8 && ['moov', 'mdat', 'wide', 'free'].includes(ascii(4, 8))) return { ext: 'mov', mime: 'video/quicktime' }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return null   // webm／mkv
  const m = mime.split(';')[0].trim().toLowerCase()
  if (m === 'video/mp4' || m === 'video/x-m4v') return { ext: 'mp4', mime: 'video/mp4' }
  if (m === 'video/quicktime') return { ext: 'mov', mime: 'video/quicktime' }
  return null
}

/**
 * 影片在框里怎么摆（PowerPoint 的影片一律拉满物件框）：
 *   contain ⇒ 物件框缩成影片比例、置中（上下或左右留白）；
 *   cover   ⇒ 物件框不动、用 srcRect 裁掉多出来的（单位 1/1000 %·PowerPoint 裁切影片同一栏）。
 *   不知道影片宽高 ⇒ 原框拉满。
 */
export function fitVideoBox(frame: { x: number; y: number; w: number; h: number }, vw: number, vh: number, fit: 'cover' | 'contain'):
  { box: { x: number; y: number; w: number; h: number }; crop: { l: number; t: number; r: number; b: number } | null } {
  if (!(vw > 0 && vh > 0 && frame.w > 0 && frame.h > 0)) return { box: frame, crop: null }
  const va = vw / vh, fa = frame.w / frame.h
  if (Math.abs(va - fa) < 0.005) return { box: frame, crop: null }
  if (fit === 'contain') {
    if (va > fa) { const h = frame.w / va; return { box: { x: frame.x, y: frame.y + (frame.h - h) / 2, w: frame.w, h }, crop: null } }
    const w = frame.h * va
    return { box: { x: frame.x + (frame.w - w) / 2, y: frame.y, w, h: frame.h }, crop: null }
  }
  if (va > fa) { const cut = Math.round(((1 - fa / va) / 2) * 100000); return { box: frame, crop: { l: cut, t: 0, r: cut, b: 0 } } }
  const cut = Math.round(((1 - va / fa) / 2) * 100000)
  return { box: frame, crop: { l: 0, t: cut, r: 0, b: cut } }
}

/** 影片物件补 srcRect（裁切）：按物件名找 <p:pic> 的 </a:blip> 或自闭合 blip 后面插 */
export function patchMediaCrop(xml: string, crops: Record<string, { l: number; t: number; r: number; b: number }>): string {
  let out = xml
  for (const [name, c] of Object.entries(crops)) {
    const at = out.indexOf(`name="${esc(name)}"`)
    if (at < 0) continue
    const end = out.indexOf('</p:pic>', at)
    if (end < 0) continue
    const seg = out.slice(at, end)
    const fixed = seg.replace(/(<a:blip\b[^>]*\/>|<a:blip\b[^>]*>[\s\S]*?<\/a:blip>)/, `$1<a:srcRect l="${c.l}" t="${c.t}" r="${c.r}" b="${c.b}"/>`)
    out = out.slice(0, at) + fixed + out.slice(end)
  }
  return out
}

/** 一页 rels 里 rId ⇒ 包内路径（ppt/…） */
export function relTargets(relsXml: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1]
    const tg = /\bTarget="([^"]+)"/.exec(m[1])?.[1]
    if (!id || !tg || /TargetMode="External"/.test(m[1])) continue
    out.set(id, tg.startsWith('../') ? `ppt/${tg.slice(3)}` : tg.startsWith('/') ? tg.slice(1) : `ppt/slides/${tg}`)
  }
  return out
}

/** 物件名 ⇒ 那支影片在包里的档（看 <p14:media r:embed> 或 <a:videoFile r:link>） */
export function mediaPartOf(slideXml: string, rels: Map<string, string>, name: string): string | null {
  const at = slideXml.indexOf(`name="${esc(name)}"`)
  if (at < 0) return null
  const end = slideXml.indexOf('</p:nvPicPr>', at)
  const seg = slideXml.slice(at, end < 0 ? at + 2000 : end)
  const rid = /<p14:media\b[^>]*r:embed="([^"]+)"/.exec(seg)?.[1] ?? /<a:videoFile\b[^>]*r:link="([^"]+)"/.exec(seg)?.[1]
  return rid ? rels.get(rid) ?? null : null
}

/** 一页的动画补丁：时间线＋本页嵌入影片＋各影片书签（物件名 ⇒ 书签） */
export type SlideTimingPatch = {
  items: TimelineItem[]
  media: SlideMediaSpec[]
  bookmarks?: Record<string, Array<{ name: string; timeMs: number }>>
}

/**
 * 物件名 ⇒ 投影片物件：完全同名；没有 ⇒ 「名字#」开头的那几个（旧整页 html 组件量出来的一堆物件·导出时命名为 编号#序）
 */
export function shapeLookup(byName: Map<string, ShapeRef[]>): (name: string) => ShapeRef[] {
  return (name) => {
    const hit = byName.get(name)
    if (hit) return hit
    const pre = `${name}#`
    const out: ShapeRef[] = []
    for (const [k, v] of byName) if (k.startsWith(pre)) out.push(...v)
    return out
  }
}

/** 改一页 XML：各物件补丁＋切换＋动画（统计回给导出报告） */
export function patchSlide(xml: string, opts: {
  transition?: PageTransition | null; shapes?: Record<string, ShapeXmlPatch>; timing?: SlideTimingPatch | null
  mediaCrop?: Record<string, { l: number; t: number; r: number; b: number }>
}): { xml: string; stats: TimingStats } {
  let out = patchSlideXml(xml, { shapes: opts.shapes })
  if (opts.mediaCrop) out = patchMediaCrop(out, opts.mediaCrop)
  let stats: TimingStats = { effects: 0, missing: 0, bookmarkTriggers: 0 }
  let timingXml = ''
  const t = opts.timing
  if (t && (t.items.length || t.media.length)) {
    const r = renumberShapeIds(out)
    out = r.xml
    const lookup = shapeLookup(r.byName)
    // 书签：补进那支影片 <p14:media …> 里（自闭合的展开）
    for (const [name, list] of Object.entries(t.bookmarks ?? {})) {
      const bl = bookmarkListXml(list)
      if (!bl) continue
      const at = out.indexOf(`name="${esc(name)}"`)
      if (at < 0) continue
      const end = out.indexOf('</p:pic>', at)
      const seg = out.slice(at, end < 0 ? undefined : end)
      const m = /<p14:media([^>]*?)\/>/.exec(seg)
      if (!m) continue
      const fixed = seg.replace(m[0], `<p14:media${m[1]}>${bl}</p14:media>`)
      out = out.slice(0, at) + fixed + (end < 0 ? '' : out.slice(end))
    }
    const built = buildTimingXml(t.items, t.media, lookup)
    timingXml = built.xml
    stats = built.stats
  }
  const tx = transitionXml(opts.transition)
  // 顺序照 schema：… clrMapOvr → transition → timing → extLst
  if (tx || timingXml) out = out.replace(/<\/p:sld>\s*$/, `${tx}${timingXml}</p:sld>`)
  return { xml: out, stats }
}

/** 改一页 XML：各物件补丁＋切换 */
export function patchSlideXml(xml: string, opts: { transition?: PageTransition | null; shapes?: Record<string, ShapeXmlPatch> }): string {
  let out = xml
  for (const [name, p] of Object.entries(opts.shapes ?? {})) {
    const at = out.indexOf(`name="${esc(name)}"`)
    if (at < 0) continue
    const start = out.lastIndexOf('<p:sp>', at)
    const end = out.indexOf('</p:sp>', at)
    if (start < 0 || end < 0) continue
    let seg = out.slice(start, end)
    const geomEnd = seg.indexOf('</a:prstGeom>')
    if (p.avLst !== undefined) seg = seg.replace(/<a:avLst\/>|<a:avLst>[\s\S]*?<\/a:avLst>/, `<a:avLst>${p.avLst}</a:avLst>`)
    if (p.useBgFill || p.gradFill) {
      const g = seg.indexOf('</a:prstGeom>')
      const head = seg.slice(0, g >= 0 ? g : geomEnd), tail = seg.slice(g >= 0 ? g : geomEnd)
      seg = head + tail.replace(FILL_RE, p.useBgFill ? '' : p.gradFill!)
      if (p.useBgFill) seg = seg.replace(/^<p:sp>/, '<p:sp useBgFill="1">')
    }
    out = out.slice(0, start) + seg + out.slice(end)
  }
  const tx = transitionXml(opts.transition)
  if (tx) out = out.replace(/<\/p:sld>\s*$/, `${tx}</p:sld>`)
  return out
}

/* ------------------------------------------------------------------ */
/* 写完档之后补包                                               */
/* ------------------------------------------------------------------ */

export type ZipLike = {
  file(path: string): { async(t: 'string'): Promise<string> } | null
  file(path: string, data: string | Uint8Array, opts?: { compression?: 'STORE' | 'DEFLATE' }): unknown
}

/**
 * 写完档之后的那一步（node 单测也走这里）：逐页补 XML（切换／形状补丁／影片裁切／动画）·影片占位档换成真档（不压缩）·mov 的 MIME 改对。
 */
export async function finishPptxZip(zip: ZipLike, o: {
  pages: Array<{ transition?: PageTransition | null; shapes?: Record<string, ShapeXmlPatch>; timing?: SlideTimingPatch | null; mediaCrop?: Record<string, { l: number; t: number; r: number; b: number }> }>
  mediaFiles: Array<{ page: number; name: string; bytes: Uint8Array; mime: string; ext: string }>
  report: { animEffects: number; animMissing: number }
}): Promise<void> {
  for (let i = 0; i < o.pages.length; i++) {
    const path = `ppt/slides/slide${i + 1}.xml`
    const f = zip.file(path)
    if (!f) continue
    const xml = await f.async('string')
    const pg = o.pages[i]
    const r = patchSlide(xml, { transition: pg.transition, shapes: pg.shapes, timing: pg.timing, mediaCrop: pg.mediaCrop })
    o.report.animEffects += r.stats.effects
    o.report.animMissing += r.stats.missing
    zip.file(path, r.xml)
    const mine = o.mediaFiles.filter((m) => m.page === i)
    if (!mine.length) continue
    const relsFile = zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`)
    if (!relsFile) continue
    const rels = relTargets(await relsFile.async('string'))
    for (const m of mine) {
      const part = mediaPartOf(r.xml, rels, m.name)
      if (part) zip.file(part, m.bytes, { compression: 'STORE' })
    }
  }
  if (o.mediaFiles.some((m) => m.ext === 'mov')) {
    const ct = zip.file('[Content_Types].xml')
    if (ct) zip.file('[Content_Types].xml', (await ct.async('string')).replace(/(Extension="mov" ContentType=")[^"]*"/, '$1video/quicktime"'))
  }
}
