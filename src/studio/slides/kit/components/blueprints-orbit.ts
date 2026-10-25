/**
 * slide-kit · 组件化 · 环绕类 4 版式的「组件蓝图」＋共用几何
 *
 *   content-orbit       环绕·总分：中心圆写总述（lead）·外大圆细线·分点（编号＋小标＋说明）绕圈均布
 *   content-orbit-loop  环绕·循环：外环切 N 段首尾相接箭头弧（arc＋lineEnds 箭头·燕尾环）
 *   content-orbit-side  环绕·偏一侧：大同心圆偏左半出画·分点只排右侧弧上
 *   content-orbit-dual  环绕·双中心：前 2 条＝两个中心圆·其余条目分两组当小标签泡泡环绕各自中心
 * 构成参考常见商务 PPT 的环绕构图·代码自研。
 *
 * 一份几何（planOrbit）两处吃：本档转成组件（颜色只用 theme:* 记号）·layouts/content-orbit.tsx 渲成旧式 React 版式
 * ⇒ 两边框位一致（components-parity 守）。分点角度按条目数算（均布·奇数偏半格免得正上／正下各一个挤标题与页底）；
 * 外圈半径从大往小试到「同侧文字块不叠·不出版心·文字栏够宽」为止（字行数用 approxLinesNeeded 估·服务端＝浏览器同解）。
 * ⛔ 本档不 import blueprints.ts（那边 import 本档·免循环）。
 */

import { approxLinesNeeded } from '../engine/fit-text'
import type { PageDraft } from '../types'
import { CANVAS_HEIGHT as H, CANVAS_WIDTH as W } from '../types'
import type { ColorValue, ComponentRole, Frame, ShapeComponent, SlideComponent, TextAlign, TextComponent, VAlign } from './types'

/* ------------------------------------------------------------------ */
/* 几何原语（蓝图与 React 版式共用）                                     */
/* ------------------------------------------------------------------ */

export type OrbitTextStyle = {
  font: 'theme:heading' | 'theme:body'
  size: number
  bold?: boolean
  lineHeight: number
  color: ColorValue
  align: TextAlign
  valign: VAlign
  maxLines: number
}

export type OrbitBox = { x: number; y: number; w: number; h: number }

export type OrbitPrim =
  /** 圆／椭圆（可带形状内文字） */
  | { k: 'ellipse'; key: string; role: ComponentRole; roleIndex?: number; box: OrbitBox; fill: ColorValue | null; stroke: { color: ColorValue; width: number } | null; opacity?: number; text?: { content: string; st: OrbitTextStyle } }
  /** 圆角框（泡泡底） */
  | { k: 'roundRect'; key: string; role: ComponentRole; roleIndex?: number; box: OrbitBox; radius: number; fill: ColorValue; stroke: { color: ColorValue; width: number } | null }
  /** 弧线（只描边·框内椭圆从 start 画到 end·度·三点钟起顺时针）·arrow＝终点箭头 */
  | { k: 'arc'; key: string; box: OrbitBox; start: number; end: number; width: number; color: ColorValue; arrow: boolean; opacity?: number }
  /** 直线（两端点·组件侧转成 line＋rotate） */
  | { k: 'line'; key: string; x1: number; y1: number; x2: number; y2: number; width: number; color: ColorValue }
  /** 文字框 */
  | { k: 'text'; key: string; role: ComponentRole; roleIndex?: number; box: OrbitBox; content: string; st: OrbitTextStyle }

export const ORBIT_LAYOUT_IDS = ['content-orbit', 'content-orbit-loop', 'content-orbit-side', 'content-orbit-dual'] as const
export type OrbitLayoutId = (typeof ORBIT_LAYOUT_IDS)[number]

/** 各版式条目容量（＝meta.slots.text.item）与建议条目数 */
export const ORBIT_CAPS: Record<OrbitLayoutId, { cap: number; range: readonly [number, number] }> = {
  'content-orbit': { cap: 8, range: [5, 8] },
  'content-orbit-loop': { cap: 6, range: [3, 6] },
  'content-orbit-side': { cap: 5, range: [3, 5] },
  // 前 2 条＝两个中心·其余 6–12 条＝泡泡
  'content-orbit-dual': { cap: 14, range: [8, 14] },
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const r1 = (n: number) => Math.round(n * 100) / 100
const rad = (deg: number) => (deg * Math.PI) / 180
const textOf = (v: unknown): string => (typeof v === 'string' ? v : '')

function box(x: number, y: number, w: number, h: number): OrbitBox {
  return { x: r1(x), y: r1(y), w: r1(Math.max(1, w)), h: r1(Math.max(1, h)) }
}

function lines(text: string, size: number, width: number, clamp: number): number {
  if (!text) return 0
  return Math.max(1, Math.min(clamp, approxLinesNeeded(text, size, width)))
}

type Item = { heading?: string; body: string }

/** 脏 deck_data 防御：非字符串一律挡掉（heading→无小标·body/title/lead→''） */
export function orbitDraft(draft: PageDraft, cap: number): { title: string; lead: string; items: Item[] } {
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

const PADX = 56, PADY = 40, BOTTOM = H - 28, EDGE = 44

/** 页标题行（圆点母题＋标题 30·两行封顶）⇒ 回传版心上缘 */
function titleRow(out: OrbitPrim[], title: string): number {
  const tW = W - 2 * PADX - 26
  const tH = lines(title, 30, tW, 2) * 30 * 1.3
  out.push({ k: 'ellipse', key: 'dot', role: 'decor', box: box(PADX, PADY + 13, 12, 12), fill: 'theme:accent', stroke: null })
  out.push({ k: 'text', key: 'title', role: 'title', box: box(PADX + 26, PADY, tW, tH || 39), content: title, st: { font: 'theme:heading', size: 30, bold: true, lineHeight: 1.3, color: 'theme:text', align: 'left', valign: 'top', maxLines: 2 } })
  return PADY + Math.max(26, tH) + 20
}

/** 分点文字块（小标＋说明）的字级 */
type Fonts = { hs: number; bs: number; bl: number }

/** 一块文字的高（给定宽） */
function blockHeight(it: Item, f: Fonts, width: number): { hH: number; bH: number; h: number } {
  const hH = it.heading ? lines(it.heading, f.hs, width, 1) * f.hs * 1.45 : 0
  const bH = lines(it.body, f.bs, width, f.bl) * f.bs * 1.55
  return { hH, bH, h: hH + (it.heading && bH ? 3 : 0) + bH }
}

/** 文字块 ⇒ 原语（小标一行·说明封顶 f.bl 行） */
function pushBlock(out: OrbitPrim[], i: number, it: Item, f: Fonts, x: number, y: number, w: number, align: TextAlign): void {
  const { hH, bH } = blockHeight(it, f, w)
  if (it.heading) {
    out.push({ k: 'text', key: `item${i}-head`, role: 'item', roleIndex: i, box: box(x, y, w, hH), content: it.heading, st: { font: 'theme:body', size: f.hs, bold: true, lineHeight: 1.45, color: 'theme:text', align, valign: 'top', maxLines: 1 } })
    y += hH + 3
  }
  out.push({ k: 'text', key: `item${i}-body`, role: 'item', roleIndex: i, box: box(x, y, w, bH || f.bs * 1.55), content: it.body, st: { font: 'theme:body', size: f.bs, lineHeight: 1.55, color: 'theme:muted', align, valign: 'top', maxLines: f.bl } })
}

/** 编号节点（实心圆＋两位数编号） */
function pushNode(out: OrbitPrim[], i: number, cx: number, cy: number, size: number): void {
  out.push({
    k: 'ellipse', key: `item${i}-num`, role: 'itemNumber', roleIndex: i, box: box(cx - size / 2, cy - size / 2, size, size),
    fill: 'theme:accent', stroke: null,
    text: { content: String(i + 1).padStart(2, '0'), st: { font: 'theme:body', size: r1(size * 0.4), bold: true, lineHeight: 1, color: 'theme:onAccent', align: 'center', valign: 'middle', maxLines: 1 } },
  })
}

/** 中心圆（实心主色＋总述字·字框取内接方块） */
function pushCenter(out: OrbitPrim[], cx: number, cy: number, r: number, lead: string, size: number): void {
  out.push({ k: 'ellipse', key: 'halo', role: 'decor', box: box(cx - r - 12, cy - r - 12, 2 * r + 24, 2 * r + 24), fill: 'theme:accent', stroke: null, opacity: 0.14 })
  out.push({ k: 'ellipse', key: 'center', role: 'decor', box: box(cx - r, cy - r, 2 * r, 2 * r), fill: 'theme:accent', stroke: null })
  if (!lead) return
  const s = r * 2 * 0.72
  const maxLines = Math.max(1, Math.floor(s / (size * 1.5)))
  const n = lines(lead, size, s, maxLines)
  const h = n * size * 1.5
  out.push({ k: 'text', key: 'lead', role: 'lead', box: box(cx - s / 2, cy - h / 2, s, h), content: lead, st: { font: 'theme:body', size, bold: true, lineHeight: 1.5, color: 'theme:onAccent', align: 'center', valign: 'middle', maxLines } })
}

/* ------------------------------------------------------------------ */
/* 绕圈均布（orbit／loop 共用）                                          */
/* ------------------------------------------------------------------ */

/** 均布角：偶数从 -90+180/n 起（左右对称·正上正下不放）·奇数从 -90+90/n 起（错半格·同样避开正上／正下） */
export function ringAngles(n: number): number[] {
  if (n <= 0) return []
  const start = n % 2 === 0 ? -90 + 180 / n : -90 + 90 / n
  return Array.from({ length: n }, (_, i) => start + (360 / n) * i)
}

type RingSlot = { a: number; nx: number; ny: number; right: boolean; x: number; y: number; w: number; h: number }

/**
 * 外圈半径从大往小试：每个分点文字块贴在节点外侧（右半圈靠左对齐往右写·左半圈靠右对齐往左写）·
 * 文字块左缘让开圆线（取块高范围内圆线最外点）；合格＝块在版心内、宽 ≥ 150、同侧相邻块上下不叠（留 8）。
 */
function solveRing(items: Item[], top: number, bottom: number, nodeSize: number, f: Fonts): { R: number; cx: number; cy: number; slots: RingSlot[] } {
  const cx = W / 2
  const cy = (top + bottom) / 2
  const angles = ringAngles(items.length)
  const rMax = Math.min((bottom - top) / 2 - 12, 200)
  const rMin = 96
  let last: { R: number; slots: RingSlot[] } = { R: rMin, slots: [] }
  for (let R = rMax; R >= rMin; R -= 4) {
    const slots: RingSlot[] = []
    let ok = true
    items.forEach((it, i) => {
      const a = angles[i]
      const nx = cx + R * Math.cos(rad(a)), ny = cy + R * Math.sin(rad(a))
      const right = Math.cos(rad(a)) >= -1e-9
      // 两轮：先按节点外缘估宽算块高·再按块高范围让开圆线重算宽与高
      let x0 = right ? nx + nodeSize / 2 + 10 : EDGE
      let w = right ? W - EDGE - x0 : nx - nodeSize / 2 - 10 - EDGE
      let h = blockHeight(it, f, Math.max(60, w)).h
      for (let pass = 0; pass < 2; pass++) {
        const y0 = ny - h / 2, y1 = ny + h / 2
        const dmin = y0 <= cy && y1 >= cy ? 0 : Math.min(Math.abs(y0 - cy), Math.abs(y1 - cy))
        const ringDx = dmin < R ? Math.sqrt(R * R - dmin * dmin) : 0
        if (right) {
          x0 = Math.max(nx + nodeSize / 2 + 10, cx + ringDx + 12)
          w = W - EDGE - x0
        } else {
          const x1 = Math.min(nx - nodeSize / 2 - 10, cx - ringDx - 12)
          x0 = EDGE
          w = x1 - EDGE
        }
        h = blockHeight(it, f, Math.max(60, w)).h
      }
      const y = ny - h / 2
      if (w < 150 || y < top || y + h > bottom) ok = false
      slots.push({ a, nx, ny, right, x: x0, y, w, h })
    })
    if (ok) {
      for (const side of [true, false]) {
        const s = slots.filter((q) => q.right === side).sort((p, q) => p.y - q.y)
        for (let j = 1; j < s.length; j++) if (s[j].y < s[j - 1].y + s[j - 1].h + 8) ok = false
      }
    }
    if (ok) return { R, cx, cy, slots }
    last = { R, slots } // 全不合格 ⇒ 用最小半径那一组（字已按行数封顶）
  }
  return { R: last.R, cx, cy, slots: last.slots }
}

function ringFonts(n: number): Fonts {
  return n <= 4 ? { hs: 17, bs: 13.5, bl: 3 } : n <= 6 ? { hs: 16, bs: 13, bl: 3 } : { hs: 15, bs: 12.5, bl: 2 }
}

function planRing(draft: PageDraft, mode: 'orbit' | 'loop'): OrbitPrim[] {
  const out: OrbitPrim[] = []
  const { title, lead, items } = orbitDraft(draft, ORBIT_CAPS[mode === 'orbit' ? 'content-orbit' : 'content-orbit-loop'].cap)
  const top = titleRow(out, title)
  const n = items.length
  const nodeSize = n <= 6 ? 36 : 32
  const f = ringFonts(n)
  const { R, cx, cy, slots } = solveRing(items, top, BOTTOM, nodeSize, f)
  const ringBox = box(cx - R, cy - R, 2 * R, 2 * R)
  if (mode === 'orbit') {
    out.push({ k: 'ellipse', key: 'ring', role: 'decor', box: ringBox, fill: null, stroke: { color: 'theme:accent', width: 2 }, opacity: 0.35 })
  } else if (n > 0) {
    // 燕尾箭头环：相邻节点之间一段弧·首尾相接·终点箭头（顺时针＝条目顺序）
    const gap = ((nodeSize / 2 + 7) / R) * (180 / Math.PI)
    slots.forEach((s, i) => {
      const next = n === 1 ? s.a + 360 : (slots[(i + 1) % n].a + (i + 1 === n ? 360 : 0))
      out.push({ k: 'arc', key: `seg${i}`, box: ringBox, start: r1(s.a + gap), end: r1(next - gap), width: 5, color: 'theme:accent', arrow: true })
    })
  }
  pushCenter(out, cx, cy, R * (mode === 'orbit' ? 0.4 : 0.38), lead, n > 6 ? 15 : 17)
  slots.forEach((s, i) => {
    pushNode(out, i, s.nx, s.ny, nodeSize)
    pushBlock(out, i, items[i], f, s.x, s.y, s.w, s.right ? 'left' : 'right')
  })
  return out
}

/* ------------------------------------------------------------------ */
/* 偏一侧                                                              */
/* ------------------------------------------------------------------ */

function planSide(draft: PageDraft): OrbitPrim[] {
  const out: OrbitPrim[] = []
  const { title, lead, items } = orbitDraft(draft, ORBIT_CAPS['content-orbit-side'].cap)
  const top = titleRow(out, title)
  const n = items.length
  const ah = BOTTOM - top
  const cy = top + ah / 2
  const cxC = 60
  const R = Math.min(300, ah * 0.64)
  const r0 = R * 0.52
  const nodeSize = 42
  // 分点：节点在弧上·纵向等距（版心高摊·块高估最大值留边）；字级从大往小试到相邻块不叠（留 8）
  const xs = (a: number) => cxC + R * Math.cos(rad(a))
  const textX = (a: number) => xs(a) + nodeSize / 2 + 16
  const tiers: Fonts[] = n <= 3
    ? [{ hs: 21, bs: 16, bl: 3 }, { hs: 19, bs: 15, bl: 2 }]
    : [{ hs: 19, bs: 15, bl: 2 }, { hs: 17, bs: 14, bl: 2 }, { hs: 16, bs: 13.5, bl: 1 }]
  let f = tiers[0], maxH = 0, Y = 0
  for (const tier of tiers) {
    f = tier
    // 最窄栏（0° 节点最靠右）估最高块
    maxH = Math.max(0, ...items.map((it) => blockHeight(it, f, W - EDGE - textX(0)).h))
    Y = Math.max(0, Math.min(0.86 * R, ah / 2 - maxH / 2 - 4))
    if (n <= 1 || (2 * Y) / (n - 1) >= maxH + 8) break
  }
  const angles = n <= 1 ? [0] : items.map((_, i) => (Math.asin((-Y + (2 * Y * i) / (n - 1)) / R) * 180) / Math.PI)
  const thetaM = n <= 1 ? 0 : (Math.asin(Y / R) * 180) / Math.PI
  // 同心圆：外圈细弧（只画右侧·免得穿过标题）＋中圈淡底＋内圈实心写总述
  const rMid = Math.min((R + r0) / 2 + 20, ah / 2 + 6)
  out.push({ k: 'ellipse', key: 'mid', role: 'decor', box: box(cxC - rMid, cy - rMid, 2 * rMid, 2 * rMid), fill: 'theme:accent', stroke: null, opacity: 0.1 })
  if (n > 0) {
    const arcPad = 14
    out.push({ k: 'arc', key: 'ring', box: box(cxC - R, cy - R, 2 * R, 2 * R), start: r1(-thetaM - arcPad), end: r1(thetaM + arcPad), width: 2, color: 'theme:accent', arrow: false, opacity: 0.4 })
  }
  out.push({ k: 'ellipse', key: 'center', role: 'decor', box: box(cxC - r0, cy - r0, 2 * r0, 2 * r0), fill: 'theme:accent', stroke: null })
  if (lead) {
    const lx = 22, rx = cxC + r0 * 0.78
    const lw = rx - lx
    const size = 16
    const maxLines = Math.max(1, Math.floor((r0 * 1.3) / (size * 1.5)))
    const h = lines(lead, size, lw, maxLines) * size * 1.5
    out.push({ k: 'text', key: 'lead', role: 'lead', box: box(lx, cy - h / 2, lw, h), content: lead, st: { font: 'theme:body', size, bold: true, lineHeight: 1.5, color: 'theme:onAccent', align: 'left', valign: 'middle', maxLines } })
  }
  items.forEach((it, i) => {
    const a = angles[i]
    const nx = xs(a), ny = cy + R * Math.sin(rad(a))
    pushNode(out, i, nx, ny, nodeSize)
    const x = textX(a)
    const w = W - EDGE - x
    const h = blockHeight(it, f, w).h
    pushBlock(out, i, it, f, x, Math.min(Math.max(ny - h / 2, top), BOTTOM - h), w, 'left')
  })
  return out
}

/* ------------------------------------------------------------------ */
/* 双中心                                                              */
/* ------------------------------------------------------------------ */

/** 一侧 k 个泡泡的角度（k=4 错 45°·其余从正上起均布；右侧镜像） */
export function dualAngles(k: number, mirror: boolean): number[] {
  if (k <= 0) return []
  const start = k === 4 ? -45 : -90
  return Array.from({ length: k }, (_, i) => {
    const a = start + (360 / k) * i
    return mirror ? 180 - a : a
  })
}

function planDual(draft: PageDraft): OrbitPrim[] {
  const out: OrbitPrim[] = []
  const { title, items } = orbitDraft(draft, ORBIT_CAPS['content-orbit-dual'].cap)
  const top = titleRow(out, title)
  const ah = BOTTOM - top
  const cy = top + ah / 2
  const centers = items.slice(0, 2)
  const rest = items.slice(2)
  const half = Math.ceil(rest.length / 2)
  const groups = [rest.slice(0, half), rest.slice(half)]
  const cxs = [270, 730]
  const rc = 76
  const bw = 140, bh = 60
  const rb = Math.min(156, ah / 2 - bh / 2 - 6)
  // 连线先画（压在泡泡与中心下面）
  const bubbles: Array<{ g: number; j: number; idx: number; x: number; y: number }> = []
  groups.forEach((g, gi) => {
    if (!centers[gi]) return
    const angs = dualAngles(g.length, gi === 1)
    g.forEach((_, j) => {
      const a = angs[j]
      const bx = cxs[gi] + rb * Math.cos(rad(a)), by = cy + rb * Math.sin(rad(a))
      const idx = 2 + (gi === 0 ? j : half + j)
      bubbles.push({ g: gi, j, idx, x: bx, y: by })
      out.push({ k: 'line', key: `item${idx}-link`, x1: r1(cxs[gi] + rc * Math.cos(rad(a))), y1: r1(cy + rc * Math.sin(rad(a))), x2: r1(bx), y2: r1(by), width: 1.5, color: 'theme:border' })
    })
  })
  // 两个中心：左实心主色·右描边（对比）
  centers.forEach((it, gi) => {
    const cx = cxs[gi]
    const solid = gi === 0
    out.push({ k: 'ellipse', key: `item${gi}-circle`, role: 'card', roleIndex: gi, box: box(cx - rc, cy - rc, 2 * rc, 2 * rc), fill: solid ? 'theme:accent' : 'theme:surface', stroke: solid ? null : { color: 'theme:accent', width: 3 } })
    const s = rc * 2 * 0.74
    const hs = 19, bs = 12.5
    const hH = it.heading ? lines(it.heading, hs, s, 2) * hs * 1.35 : 0
    const bl = it.heading ? 2 : 4
    const bH = lines(it.body, bs, s, bl) * bs * 1.5
    const total = hH + (hH && bH ? 4 : 0) + bH
    let y = cy - total / 2
    if (it.heading) {
      out.push({ k: 'text', key: `item${gi}-head`, role: 'item', roleIndex: gi, box: box(cx - s / 2, y, s, hH), content: it.heading, st: { font: 'theme:heading', size: hs, bold: true, lineHeight: 1.35, color: solid ? 'theme:onAccent' : 'theme:text', align: 'center', valign: 'top', maxLines: 2 } })
      y += hH + 4
    }
    out.push({ k: 'text', key: `item${gi}-body`, role: 'item', roleIndex: gi, box: box(cx - s / 2, y, s, bH || bs * 1.5), content: it.body, st: { font: 'theme:body', size: bs, lineHeight: 1.5, color: solid ? 'theme:onAccent' : 'theme:muted', align: 'center', valign: 'top', maxLines: bl } })
  })
  // 泡泡：圆角胶囊·小标一行＋说明（有小标 1 行·没小标 2 行）
  for (const b of bubbles) {
    const it = items[b.idx]
    const x = b.x - bw / 2, y = b.y - bh / 2
    out.push({ k: 'roundRect', key: `item${b.idx}-card`, role: 'card', roleIndex: b.idx, box: box(x, y, bw, bh), radius: bh / 2, fill: 'theme:surface', stroke: { color: 'theme:accent', width: 1.2 } })
    const tw = bw - 28
    const hs = 13.5, bs = 11.5
    const hH = it.heading ? hs * 1.4 : 0
    const bl = it.heading ? 1 : 2
    const bH = lines(it.body, bs, tw, bl) * bs * 1.45
    const total = hH + (hH && bH ? 1 : 0) + bH
    let ty = b.y - total / 2
    if (it.heading) {
      out.push({ k: 'text', key: `item${b.idx}-head`, role: 'item', roleIndex: b.idx, box: box(x + 14, ty, tw, hH), content: it.heading, st: { font: 'theme:body', size: hs, bold: true, lineHeight: 1.4, color: 'theme:text', align: 'center', valign: 'top', maxLines: 1 } })
      ty += hH + 1
    }
    out.push({ k: 'text', key: `item${b.idx}-body`, role: 'item', roleIndex: b.idx, box: box(x + 14, ty, tw, bH || bs * 1.45), content: it.body, st: { font: 'theme:body', size: bs, lineHeight: 1.45, color: 'theme:muted', align: 'center', valign: 'top', maxLines: bl } })
  }
  return out
}

/** 版式 id ⇒ 几何原语（未知 id ⇒ []） */
export function planOrbit(layoutId: string, draft: PageDraft): OrbitPrim[] {
  switch (layoutId) {
    case 'content-orbit': return planRing(draft, 'orbit')
    case 'content-orbit-loop': return planRing(draft, 'loop')
    case 'content-orbit-side': return planSide(draft)
    case 'content-orbit-dual': return planDual(draft)
    default: return []
  }
}

/* ------------------------------------------------------------------ */
/* 原语 ⇒ 组件                                                          */
/* ------------------------------------------------------------------ */

const fr = (b: OrbitBox, rotate = 0): Frame => ({ x: b.x, y: b.y, w: b.w, h: b.h, rotate })

function textBox(st: OrbitTextStyle) {
  return {
    font: st.font, size: st.size, color: st.color, ...(st.bold ? { bold: true } : {}),
    align: st.align, valign: st.valign, lineHeight: st.lineHeight, padding: 0, clamp: true, maxLines: st.maxLines,
  }
}

export function orbitPrimToComponent(p: OrbitPrim, pageKey: string): SlideComponent {
  const id = `${pageKey}.${p.key}`
  switch (p.k) {
    case 'text': {
      const c: TextComponent = {
        id, type: 'text', role: p.role, ...(p.roleIndex !== undefined ? { roleIndex: p.roleIndex } : {}), frame: fr(p.box),
        paragraphs: [{ runs: p.content ? [{ text: p.content }] : [] }], box: textBox(p.st),
      }
      return c
    }
    case 'ellipse': {
      const c: ShapeComponent = {
        id, type: 'shape', role: p.role, ...(p.roleIndex !== undefined ? { roleIndex: p.roleIndex } : {}), frame: fr(p.box),
        shape: 'ellipse', fill: p.fill, stroke: p.stroke, ...(p.opacity !== undefined ? { opacity: p.opacity } : {}),
        ...(p.text ? { text: { paragraphs: [{ runs: [{ text: p.text.content }] }], box: textBox(p.text.st) } } : {}),
      }
      return c
    }
    case 'roundRect':
      return { id, type: 'shape', role: p.role, ...(p.roleIndex !== undefined ? { roleIndex: p.roleIndex } : {}), frame: fr(p.box), shape: 'roundRect', radius: p.radius, fill: p.fill, stroke: p.stroke }
    case 'arc':
      return {
        id, type: 'shape', role: 'decor', frame: fr(p.box), shape: 'arc', fill: null,
        stroke: { color: p.color, width: p.width }, arc: { start: p.start, end: p.end },
        ...(p.opacity !== undefined ? { opacity: p.opacity } : {}),
        ...(p.arrow ? { lineEnds: { end: 'arrow' } } : {}),
      }
    case 'line': {
      const dx = p.x2 - p.x1, dy = p.y2 - p.y1
      const len = Math.max(1, Math.hypot(dx, dy))
      const mx = (p.x1 + p.x2) / 2, my = (p.y1 + p.y2) / 2
      const deg = r1((Math.atan2(dy, dx) * 180) / Math.PI)
      return { id, type: 'shape', role: 'decor', frame: { ...fr(box(mx - len / 2, my - 1, len, 2)), rotate: deg }, shape: 'line', fill: null, stroke: { color: p.color, width: p.width } }
    }
  }
}

type BlueprintInput = { pageKey: string; draft: PageDraft }

const bp = (id: OrbitLayoutId) => ({ pageKey, draft }: BlueprintInput): SlideComponent[] =>
  planOrbit(id, draft).map((p) => orbitPrimToComponent(p, pageKey))

export const contentOrbitBlueprint = bp('content-orbit')
export const contentOrbitLoopBlueprint = bp('content-orbit-loop')
export const contentOrbitSideBlueprint = bp('content-orbit-side')
export const contentOrbitDualBlueprint = bp('content-orbit-dual')
