/**
 * slide-kit · 组件化 · 新增的 6 个内容版式的组件蓝图
 *
 *   content-waist        拦腰·总分（满宽主色带：总述＋图标关键词·带下 n 栏衬底卡·带右上出框图）
 *   content-waist-duo    拦腰·两段并列（带上一段·带内一段·带右侧上下出框图）
 *   content-fan          扇形（底部同心双半圆写总述·放射线把上方分成 n 扇区放分点）
 *   content-beam         倒三角＋底圆（中间倒三角光束·底部圆形图·左中右三分点）
 *   content-split-steps  分割·递进（n 块浅→深主色·块角超大序号·底部一根贯穿箭头）
 *   content-split-duo    分割·两段（上浅色块·下图片色块＋毛玻璃卡·各带左侧竖排小标签）
 *
 * 版式参考常见商务 PPT 构图·坐标自算。
 * 与 blueprints.ts 同法：坐标系 1000×562.5·颜色字体只用 theme:* 记号（换主题自动跟着换）·行数用近似字宽表估（服务端＝浏览器同一结果）。
 * 现成组件能力（de4fcdfa）：ring＋arc 画半圆／扇形、arc 画弧线、line 画放射线与箭头、gradient 渐层光束、backdropBlur 毛玻璃卡。
 * 本档不 import blueprints.ts 的执行期值（只取型别）⇒ blueprints.ts 反过来 import 本档没有循环依赖。
 *
 * 总述（lead）：从 draft 防御性读取 lead（字串·选填·PageDraft 型别未声明此栏）；没有就不画总述。
 */

import { approxLinesNeeded } from '../engine/fit-text'
import type { PageDraft, SlotImageValue } from '../types'
import { CANVAS_HEIGHT as H, CANVAS_WIDTH as W, imageSlotKey, resolveSlotImage } from '../types'
import { pad2 } from '../layouts/shared'
import type { BlueprintInput } from './blueprints'
import type { ColorValue, ComponentRole, Frame, ImageComponent, ShapeComponent, SlideComponent, TextAlign, TextBox, TextComponent, VAlign } from './types'

type Blueprint = (input: BlueprintInput) => SlideComponent[]

/* ------------------------------------------------------------------ */
/* 小工具（与 blueprints.ts 同口径·本档自带一份免循环依赖）              */
/* ------------------------------------------------------------------ */

const r1 = (n: number) => Math.round(n * 100) / 100

function frame(x: number, y: number, w: number, h: number, rotate = 0): Frame {
  return { x: r1(x), y: r1(y), w: r1(Math.max(1, w)), h: r1(Math.max(1, h)), rotate }
}

function lines(text: string | undefined, size: number, width: number, clamp: number): number {
  if (!text) return 0
  return Math.max(1, Math.min(clamp, approxLinesNeeded(text, size, width)))
}

function blockH(text: string | undefined, size: number, lh: number, width: number, clamp: number): number {
  return lines(text, size, width, clamp) * size * lh
}

/** 可用高度能放几行（至少 1·封顶 cap） */
function fitLines(avail: number, size: number, lh: number, cap: number): number {
  return Math.max(1, Math.min(cap, Math.floor(avail / (size * lh))))
}

type TextOpts = {
  font?: 'theme:heading' | 'theme:body'
  size: number
  color?: ColorValue
  bold?: boolean
  lineHeight: number
  align?: TextAlign
  valign?: VAlign
  maxLines?: number
}

function text(id: string, role: ComponentRole, f: Frame, content: string, o: TextOpts, roleIndex?: number): TextComponent {
  const box: TextBox = {
    font: o.font ?? 'theme:body',
    size: o.size,
    color: o.color ?? 'theme:text',
    ...(o.bold ? { bold: true } : {}),
    align: o.align ?? 'left',
    valign: o.valign ?? 'top',
    lineHeight: o.lineHeight,
    padding: 0,
    clamp: true,
    ...(o.maxLines ? { maxLines: o.maxLines } : {}),
  }
  return {
    id, type: 'text', role, ...(roleIndex !== undefined ? { roleIndex } : {}), frame: f,
    paragraphs: [{ runs: content ? [{ text: content }] : [] }],
    box,
  }
}

function dot(id: string, x: number, y: number, size: number, color: ColorValue = 'theme:accent', opacity?: number): ShapeComponent {
  return {
    id, type: 'shape', role: 'decor', frame: frame(x, y, size, size), shape: 'ellipse',
    fill: color, stroke: null, ...(opacity !== undefined ? { opacity } : {}),
  }
}

function rect(id: string, role: ComponentRole, f: Frame, fill: ColorValue, extra: Partial<ShapeComponent> = {}): ShapeComponent {
  return { id, type: 'shape', role, frame: f, shape: 'rect', fill, stroke: null, ...extra }
}

function figure(id: string, role: ComponentRole, f: Frame, v: SlotImageValue | undefined, radius: number, roleIndex?: number): ImageComponent {
  const img = resolveSlotImage(v)
  return {
    id, type: 'image', role, ...(roleIndex !== undefined ? { roleIndex } : {}), frame: f,
    src: img.url ?? '', ...(img.crop ? { crop: img.crop } : {}), fit: 'cover', radius,
  }
}

/** 两点连线（line 形状：框中心＝中点·宽＝长度·按角度转） */
function segment(id: string, x0: number, y0: number, x1: number, y1: number, color: ColorValue, width: number, opacity?: number): ShapeComponent {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const deg = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI
  const rot = Math.round((((deg % 360) + 360) % 360) * 100) / 100
  const h = Math.max(2, width * 2)
  return {
    id, type: 'shape', role: 'decor', frame: frame((x0 + x1) / 2 - len / 2, (y0 + y1) / 2 - h / 2, len, h, rot),
    shape: 'line', stroke: { color, width }, ...(opacity !== undefined ? { opacity } : {}),
  }
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 含中日韩字（竖排小标签用：有 ⇒ 一字一行直排；没有 ⇒ 整串转 270° 侧排） */
const CJK_RE = /[⺀-鿿豈-﫿぀-ヿ가-힯]/

type Item = { heading?: string; body: string }

/** 取 content draft（脏资料防御同 blueprints.contentOf）＋选填总述 lead */
function v2ContentOf(draft: PageDraft, cap: number): { title: string; lead: string; items: Item[] } {
  if (draft.type !== 'content') return { title: '', lead: '', items: [] }
  const raw = Array.isArray(draft.items) ? draft.items : []
  return {
    title: textOf(draft.title),
    lead: textOf((draft as { lead?: unknown }).lead),
    items: raw.slice(0, cap).map((it) => {
      const h = (it as { heading?: unknown } | null)?.heading
      const b = textOf((it as { body?: unknown } | null)?.body)
      return typeof h === 'string' && h ? { heading: h, body: b } : { body: b }
    }),
  }
}

const PADX = 64, PADY = 44
const TITLE_SIZE = 30

/** 页标题行（Dot 母题＋标题 30·两行封顶）·回传占高 */
function titleRow(k: (s: string) => string, width: number, title: string): { comps: SlideComponent[]; bottom: number } {
  const tW = width - 26
  const tH = blockH(title, TITLE_SIZE, 1.3, tW, 2)
  const oneLine = TITLE_SIZE * 1.3
  return {
    comps: [
      dot(k('dot'), PADX, PADY + (oneLine - 12) / 2, 12),
      text(k('title'), 'title', frame(PADX + 26, PADY, tW, tH || oneLine), title, { font: 'theme:heading', size: TITLE_SIZE, bold: true, lineHeight: 1.3, color: 'theme:text', maxLines: 2 }),
    ],
    bottom: PADY + Math.max(oneLine, tH),
  }
}

/* ------------------------------------------------------------------ */
/* content-waist：拦腰·总分                                            */
/* ------------------------------------------------------------------ */

const contentWaist: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, lead, items } = v2ContentOf(draft, 4)
  const n = items.length
  const figW = 230, figH = 170
  const figX = W - PADX - figW
  const tr = titleRow(k, figX - 24 - PADX, title)
  const out: SlideComponent[] = [...tr.comps]
  const bandH = 132, gap = 18
  // 带下卡：先按「带贴着标题」算可用高与卡高·剩下的空白一半挪到上面（带＋卡整组在标题下置中·带落在页高约 25–55%）
  const minBandY = tr.bottom + 26
  const availH = H - 36 - (minBandY + bandH + 22)
  const cardW = n > 0 ? (W - 2 * PADX - gap * (n - 1)) / n : 0
  const tw = cardW - 40
  const maxL = fitLines(availH - 60, 15, 1.6, 7)
  // 卡高跟最长那条走（不留一大片空卡）·至少 120·至多可用高
  const cardH = n > 0 ? Math.min(availH, Math.max(120, ...items.map((it) => blockH(it.body, 15, 1.6, tw, maxL) + 64))) : 0
  const bandY = minBandY + Math.max(0, availH - cardH) / 2
  out.push(rect(k('band'), 'decor', frame(0, bandY, W, bandH), 'theme:accent'))
  // 带内：总述（选填）＋ n 个关键词（编号圆＋小标）
  const innerW = figX - 28 - PADX
  const leadH = blockH(lead, 17, 1.5, innerW, 2)
  const chipH = n > 0 ? 32 : 0
  const group = leadH + (lead && n > 0 ? 16 : 0) + chipH
  let y = bandY + (bandH - group) / 2
  if (lead) {
    out.push(text(k('lead'), 'lead', frame(PADX, y, innerW, leadH), lead, { size: 17, bold: true, lineHeight: 1.5, color: 'theme:onAccent', maxLines: 2 }))
    y += leadH + 16
  }
  const chipW = n > 0 ? innerW / n : 0
  items.forEach((it, i) => {
    const x = PADX + i * chipW
    out.push({
      id: k(`item${i}-num`), type: 'shape', role: 'itemNumber', roleIndex: i, frame: frame(x, y, 32, 32), shape: 'ellipse',
      fill: 'theme:onAccent', stroke: null,
      text: { paragraphs: [{ runs: [{ text: pad2(i) }] }], box: { font: 'theme:body', size: 13, color: 'theme:accent', bold: true, align: 'center', valign: 'middle', lineHeight: 1, padding: 0 } },
    })
    if (it.heading) out.push(text(k(`item${i}-head`), 'item', frame(x + 40, y, chipW - 40 - 12, 32), it.heading, { size: 15, bold: true, lineHeight: 1.45, color: 'theme:onAccent', valign: 'middle', maxLines: 1 }, i))
  })
  // 带右上出框衬底图（盖在带上）
  out.push(figure(k('fig'), 'pageFigure', frame(figX, bandY - 46, figW, figH), images?.[imageSlotKey('pageFigure')], 16))
  // 带下 n 栏衬底卡
  if (n > 0) {
    const top = bandY + bandH + 22
    items.forEach((it, i) => {
      const x = PADX + i * (cardW + gap)
      out.push({ id: k(`item${i}-card`), type: 'shape', role: 'card', roleIndex: i, frame: frame(x, top, cardW, cardH), shape: 'roundRect', radius: 14, fill: 'theme:surface', stroke: { color: 'theme:border', width: 1 } })
      out.push(dot(k(`item${i}-dot`), x + 20, top + 22, 8))
      const bH = blockH(it.body, 15, 1.6, tw, maxL)
      out.push(text(k(`item${i}-body`), 'item', frame(x + 20, top + 42, tw, bH || 24), it.body, { size: 15, lineHeight: 1.6, color: 'theme:muted', maxLines: maxL }, i))
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* content-waist-duo：拦腰·两段并列                                    */
/* ------------------------------------------------------------------ */

const contentWaistDuo: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = v2ContentOf(draft, 2)
  const tr = titleRow(k, W - 2 * PADX, title)
  const out: SlideComponent[] = [...tr.comps]
  const areaTop = tr.bottom + 22
  const bandH = 196, bandY = H - 40 - bandH
  const figW = 270, figX = W - PADX - figW
  const textW = figX - 40 - PADX
  /** 一段（小标＋正文）：在 [top, bottom] 区间里垂直置中 */
  const block = (it: Item, i: number, top: number, bottom: number, onBand: boolean) => {
    const hH = it.heading ? 20 * 1.45 : 0
    const avail = bottom - top - (it.heading ? hH + 8 : 0)
    const maxL = fitLines(avail, 16, 1.6, 4)
    const bH = blockH(it.body, 16, 1.6, textW - 20, maxL)
    const total = (it.heading ? hH + 8 : 0) + bH
    let y = top + Math.max(0, (bottom - top - total) / 2)
    const ink: ColorValue = onBand ? 'theme:onAccent' : 'theme:text'
    if (it.heading) {
      out.push(dot(k(`item${i}-dot`), PADX, y + (hH - 10) / 2, 10, onBand ? 'theme:onAccent' : 'theme:accent'))
      out.push(text(k(`item${i}-head`), 'item', frame(PADX + 20, y, textW - 20, hH), it.heading, { size: 20, bold: true, lineHeight: 1.45, color: ink, maxLines: 1 }, i))
      y += hH + 8
    }
    out.push(text(k(`item${i}-body`), 'item', frame(PADX + 20, y, textW - 20, bH || 25.6), it.body, { size: 16, lineHeight: 1.6, color: onBand ? 'theme:onAccent' : 'theme:muted', maxLines: maxL }, i))
  }
  out.push(rect(k('band'), 'decor', frame(0, bandY, W, bandH), 'theme:accent'))
  // 2 段：第一段在带上方、第二段在带内；只有 1 段：放带内
  if (items.length >= 2) block(items[0], 0, areaTop, bandY - 18, false)
  const inBand = items.length >= 2 ? 1 : 0
  if (items[inBand]) block(items[inBand], inBand, bandY + 24, bandY + bandH - 24, true)
  // 带右侧出框图（上出 120·下出 20）
  out.push(figure(k('fig'), 'pageFigure', frame(figX, bandY - 120, figW, bandH + 140), images?.[imageSlotKey('pageFigure')], 18))
  return out
}

/* ------------------------------------------------------------------ */
/* content-fan：扇形                                                   */
/* ------------------------------------------------------------------ */

const contentFan: Blueprint = ({ pageKey, draft }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, lead, items } = v2ContentOf(draft, 4)
  const n = items.length
  const tr = titleRow(k, W - 2 * PADX, title)
  const out: SlideComponent[] = [...tr.comps]
  const areaTop = tr.bottom + 20
  const cx = W / 2, cy = H
  const rIn = 128, rArc = 170
  // 同心双半圆：实心半圆（ring 厚 0.5＝实心·只画上半 180→360）＋外圈细弧（arc）
  out.push({ id: k('disc'), type: 'shape', role: 'decor', frame: frame(cx - rIn, cy - rIn, rIn * 2, rIn * 2), shape: 'ring', thickness: 0.5, arc: { start: 180, end: 360 }, fill: 'theme:accent', stroke: null })
  out.push({ id: k('arc'), type: 'shape', role: 'decor', frame: frame(cx - rArc, cy - rArc, rArc * 2, rArc * 2), shape: 'arc', arc: { start: 180, end: 360 }, stroke: { color: 'theme:accent', width: 3 }, opacity: 0.6 })
  if (lead) {
    const lW = 190
    const lH = blockH(lead, 15, 1.45, lW, 3)
    out.push(text(k('lead'), 'lead', frame(cx - lW / 2, cy - 92, lW, lH), lead, { size: 15, bold: true, lineHeight: 1.45, color: 'theme:onAccent', align: 'center', maxLines: 3 }))
  }
  if (n === 0) return out
  // 放射线：把上半圆分成 n 扇区（线从外弧外侧起·不碰标题区）
  const rad = (deg: number) => (deg * Math.PI) / 180
  const rays: Array<[number, number, number, number]> = []
  for (let j = 1; j < n; j++) {
    const a = rad(180 + (j * 180) / n)
    const r0 = rArc + 20
    const r1max = Math.min(420, (cy - (areaTop + 10)) / Math.max(0.2, Math.abs(Math.sin(a))))
    const seg: [number, number, number, number] = [cx + r0 * Math.cos(a), cy + r0 * Math.sin(a), cx + r1max * Math.cos(a), cy + r1max * Math.sin(a)]
    rays.push(seg)
    out.push(segment(k(`ray${j}`), seg[0], seg[1], seg[2], seg[3], 'theme:border', 1.5))
  }
  /** 方块离每条放射线都 ≥ 10px（沿线取样） */
  const clear = (x: number, y: number, w: number, h: number) => rays.every(([x0, y0, x1, y1]) => {
    for (let s = 0; s <= 60; s++) {
      const px = x0 + ((x1 - x0) * s) / 60, py = y0 + ((y1 - y0) * s) / 60
      if (px > x - 10 && px < x + w + 10 && py > y - 10 && py < y + h + 10) return false
    }
    return true
  })
  const bw = n === 1 ? 420 : n === 2 ? 300 : n === 3 ? 250 : 190
  const R0 = n === 1 ? 260 : 300
  items.forEach((it, i) => {
    const a = rad(180 + ((i + 0.5) * 180) / n)
    const hH = blockH(it.heading, 17, 1.45, bw, 2)
    const bH = blockH(it.body, 14, 1.55, bw, 3)
    const total = hH + (it.heading ? 6 : 0) + bH
    // 从扇区中线 R0 处起放·压到线就沿中线往外推（确定性·同输入同结果）
    const place = (R: number) => {
      const px = cx + R * Math.cos(a), py = cy + R * Math.sin(a)
      return { x: Math.max(PADX, Math.min(W - PADX - bw, px - bw / 2)), y: Math.max(areaTop, Math.min(H - 24 - total, py - total / 2)) }
    }
    let { x, y } = place(R0)
    for (let R = R0 + 6; R <= R0 + 120 && !clear(x, y, bw, total); R += 6) ({ x, y } = place(R))
    let yy = y
    if (it.heading) {
      out.push(text(k(`item${i}-head`), 'item', frame(x, yy, bw, hH), it.heading, { size: 17, bold: true, lineHeight: 1.45, color: 'theme:text', align: 'center', maxLines: 2 }, i))
      yy += hH + 6
    }
    out.push(text(k(`item${i}-body`), 'item', frame(x, yy, bw, bH || 21.7), it.body, { size: 14, lineHeight: 1.55, color: 'theme:muted', align: 'center', maxLines: 3 }, i))
  })
  return out
}

/* ------------------------------------------------------------------ */
/* content-beam：倒三角光束＋底圆                                      */
/* ------------------------------------------------------------------ */

const contentBeam: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = v2ContentOf(draft, 3)
  const n = items.length
  const tr = titleRow(k, W - 2 * PADX, title)
  const out: SlideComponent[] = [...tr.comps]
  const areaTop = tr.bottom + 20
  const cx = W / 2
  const d = 136, cTop = H - 34 - d
  const beamW = 340, beamBottom = cTop + 20
  // 倒三角（三角形转 180°）·渐层：近底圆处主色→上方淡入页底色（转了 180° ⇒ 局部「上」＝画面下）
  out.push({
    id: k('beam'), type: 'shape', role: 'decor', frame: frame(cx - beamW / 2, areaTop, beamW, beamBottom - areaTop, 180), shape: 'triangle',
    fill: 'theme:accent', fillMode: 'gradient', gradient: { angle: 90, stops: [{ pos: 0, color: 'theme:accent' }, { pos: 100, color: 'theme:bg' }] }, stroke: null, opacity: 0.32,
  })
  // 底圆（可填图·itemFigure:0）＋外圈
  out.push({ id: k('halo'), type: 'shape', role: 'decor', frame: frame(cx - d / 2 - 9, cTop - 9, d + 18, d + 18), shape: 'ellipse', fill: null, stroke: { color: 'theme:accent', width: 3 } })
  out.push(figure(k('fig'), 'itemFigure', frame(cx - d / 2, cTop, d, d), images?.[imageSlotKey('itemFigure', 0)], d / 2, 0))
  if (n === 0) return out
  const sideW = 256
  // 槽位：3 条＝左中右；2 条＝左右；1 条＝中
  const slots: Array<'left' | 'center' | 'right'> = n === 1 ? ['center'] : n === 2 ? ['left', 'right'] : ['left', 'center', 'right']
  items.forEach((it, i) => {
    const pos = slots[i]
    const align: TextAlign = pos === 'left' ? 'right' : pos === 'right' ? 'left' : 'center'
    const bw = pos === 'center' ? 260 : sideW
    const maxB = pos === 'center' ? 4 : 5
    const hH = blockH(it.heading, 18, 1.45, bw, 2)
    const bH = blockH(it.body, 14.5, 1.6, bw, maxB)
    const total = hH + (it.heading ? 8 : 0) + bH
    const x = pos === 'left' ? PADX : pos === 'right' ? W - PADX - sideW : cx - bw / 2
    const y = pos === 'center' ? areaTop + 14 : areaTop + Math.max(0, (H - 60 - areaTop - total) / 2)
    let yy = y
    if (it.heading) {
      out.push(text(k(`item${i}-head`), 'item', frame(x, yy, bw, hH), it.heading, { size: 18, bold: true, lineHeight: 1.45, color: 'theme:text', align, maxLines: 2 }, i))
      yy += hH + 8
    }
    out.push(text(k(`item${i}-body`), 'item', frame(x, yy, bw, bH || 23.2), it.body, { size: 14.5, lineHeight: 1.6, color: 'theme:muted', align, maxLines: maxB }, i))
    if (pos !== 'center') out.push(dot(k(`item${i}-dot`), pos === 'left' ? x + bw + 14 : x - 24, y + (it.heading ? (hH - 10) / 2 : 6), 10))
  })
  return out
}

/* ------------------------------------------------------------------ */
/* content-split-steps：分割·递进                                      */
/* ------------------------------------------------------------------ */

const STEP_TINTS: Record<number, number[]> = { 1: [1], 2: [0.2, 1], 3: [0.14, 0.34, 1] }

const contentSplitSteps: Blueprint = ({ pageKey, draft }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = v2ContentOf(draft, 3)
  const n = items.length
  const tr = titleRow(k, W - 2 * PADX, title)
  const out: SlideComponent[] = [...tr.comps]
  const top = tr.bottom + 22, bottom = H - 86
  if (n === 0) return out
  const bw = (W - 2 * PADX) / n
  const tints = STEP_TINTS[n] ?? STEP_TINTS[3]
  const numSize = 64, numW = 2 * 0.62 * numSize + 12
  items.forEach((it, i) => {
    const x = PADX + i * bw
    const last = i === n - 1
    const op = tints[i] ?? 1
    out.push({ id: k(`item${i}-card`), type: 'shape', role: 'card', roleIndex: i, frame: frame(x, top, bw, bottom - top), shape: 'rect', fill: 'theme:accent', stroke: null, ...(op < 1 ? { opacity: op } : {}) })
    // 块角超大序号（右上）
    out.push(text(k(`item${i}-num`), 'itemNumber', frame(x + bw - 22 - numW, top + 14, numW, numSize), pad2(i), { font: 'theme:heading', size: numSize, bold: true, lineHeight: 1, color: last ? 'theme:onAccent' : 'theme:accent', align: 'right', maxLines: 1 }, i))
    const tw = bw - 48
    let y = top + 14 + numSize + 14
    const ink: ColorValue = last ? 'theme:onAccent' : 'theme:text'
    if (it.heading) {
      const hH = blockH(it.heading, 19, 1.45, tw, 2)
      out.push(text(k(`item${i}-head`), 'item', frame(x + 24, y, tw, hH), it.heading, { size: 19, bold: true, lineHeight: 1.45, color: ink, maxLines: 2 }, i))
      y += hH + 10
    }
    const maxL = fitLines(bottom - 20 - y, 14.5, 1.6, 7)
    const bH = blockH(it.body, 14.5, 1.6, tw, maxL)
    out.push(text(k(`item${i}-body`), 'item', frame(x + 24, y, tw, bH || 23.2), it.body, { size: 14.5, lineHeight: 1.6, color: ink, maxLines: maxL }, i))
  })
  // 一根贯穿箭头（块下方）＋每块一颗节点
  const ay = H - 52
  out.push({ id: k('arrow'), type: 'shape', role: 'decor', frame: frame(PADX, ay - 8, W - 2 * PADX, 16), shape: 'line', stroke: { color: 'theme:accent', width: 3 }, lineEnds: { end: 'arrow' } })
  items.forEach((_, i) => out.push(dot(k(`node${i}`), PADX + (i + 0.5) * bw - 7, ay - 7, 14)))
  return out
}

/* ------------------------------------------------------------------ */
/* content-split-duo：分割·两段（上浅·下图＋毛玻璃）                    */
/* ------------------------------------------------------------------ */

const contentSplitDuo: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = v2ContentOf(draft, 2)
  const tr = titleRow(k, W - 2 * PADX, title)
  const out: SlideComponent[] = [...tr.comps]
  const areaTop = tr.bottom + 22, areaBottom = H - 36, gap = 16
  const bandH = (areaBottom - areaTop - gap) / 2
  const bandW = W - 2 * PADX
  const yA = areaTop, yB = areaTop + bandH + gap
  /** 竖排小标签＋细竖线＋正文（在 [x, x+w] × [y, y+h] 里） */
  const block = (it: Item, i: number, x: number, y: number, w: number, h: number) => {
    const labelX = x + 22
    out.push(rect(k(`item${i}-rule`), 'decor', frame(labelX + 30, y + 22, 3, h - 44), 'theme:accent'))
    if (it.heading) {
      if (CJK_RE.test(it.heading)) {
        const size = 17, lh = 1.25
        const maxL = fitLines(h - 40, size, lh, 12)
        const L = Math.min(maxL, [...it.heading].length)
        const lH = L * size * lh
        out.push(text(k(`item${i}-head`), 'item', frame(labelX, y + (h - lH) / 2, size + 4, lH), it.heading, { size, bold: true, lineHeight: lh, color: 'theme:accent', align: 'center', maxLines: maxL }, i))
      } else {
        // 无中日韩字：整串转 270°（由下往上读）·框中心落在标签栏中线上
        const L = h - 40, th = 22
        out.push(text(k(`item${i}-head`), 'item', frame(labelX + 11 - L / 2, y + h / 2 - th / 2, L, th, 270), it.heading, { size: 15, bold: true, lineHeight: 1.4, color: 'theme:accent', align: 'center', valign: 'middle', maxLines: 1 }, i))
      }
    }
    const bx = labelX + 54, bwid = x + w - 26 - bx
    const maxL = fitLines(h - 36, 17, 1.6, 5)
    const bH = blockH(it.body, 17, 1.6, bwid, maxL)
    out.push(text(k(`item${i}-body`), 'item', frame(bx, y + (h - (bH || 27.2)) / 2, bwid, bH || 27.2), it.body, { size: 17, lineHeight: 1.6, color: 'theme:text', maxLines: maxL }, i))
  }
  // 上：浅色块
  out.push({ id: k('band-a'), type: 'shape', role: 'card', roleIndex: 0, frame: frame(PADX, yA, bandW, bandH), shape: 'roundRect', radius: 16, fill: 'theme:surface', stroke: { color: 'theme:border', width: 1 } })
  if (items[0]) block(items[0], 0, PADX, yA, bandW, bandH)
  // 下：图片色块＋毛玻璃卡
  out.push(figure(k('fig'), 'pageFigure', frame(PADX, yB, bandW, bandH), images?.[imageSlotKey('pageFigure')], 16))
  if (items[1]) {
    const gx = PADX + 16, gy = yB + 16, gw = bandW * 0.64, gh = bandH - 32
    out.push({ id: k('glass'), type: 'shape', role: 'card', roleIndex: 1, frame: frame(gx, gy, gw, gh), shape: 'roundRect', radius: 12, fill: 'theme:surface', stroke: null, opacity: 0.8, backdropBlur: 14 })
    block(items[1], 1, gx, gy, gw, gh)
  }
  return out
}

/* ------------------------------------------------------------------ */

/** 并进 blueprints.ts 的 BLUEPRINTS（键＝版式 id） */
export const WAIST_FAN_BLUEPRINTS: Readonly<Record<string, Blueprint>> = {
  'content-waist': contentWaist,
  'content-waist-duo': contentWaistDuo,
  'content-fan': contentFan,
  'content-beam': contentBeam,
  'content-split-steps': contentSplitSteps,
  'content-split-duo': contentSplitDuo,
}
