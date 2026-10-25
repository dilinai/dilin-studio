/**
 * 框的几何（纯函数·零 DOM·零依赖）——原简报 deck-editor/transform.ts·
 * 抽进 frame-kit 给简报／云文档／云表格共用（行为零变化）。
 *
 * 只动框（长宽／移动／旋转／叠层）：
 *   · 拖动：吸附页面边缘与中线、其他框的边线与中线，回报要画的参考线；
 *   · 缩放：8 个把手（四角＋四边），旋转过的框在自己的座标系里缩，对边／对角那一点钉住不动；Shift＝锁比例；
 *   · 旋转：以框中心为轴顺时针（收进 [0,360)），Shift 每 15° 一格，否则靠近 0／90／180／270 自动吸；
 *   · 方向键：1，Shift 10。
 * 页面尺寸一律由宿主传入（PageSize·与 Frame 同单位）：简报传 1000×562.5，文档传纸张毫米。
 */

import { DEFAULT_FRAME_LIMITS, type Frame, type FrameLimits, type PageSize, type ZDir } from './types'

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** 把手方向：x／y 各 -1｜0｜1（e＝+x，s＝+y） */
export function handleSign(h: Handle): { hx: -1 | 0 | 1; hy: -1 | 0 | 1 } {
  return {
    hx: h.includes('e') ? 1 : h.includes('w') ? -1 : 0,
    hy: h.includes('s') ? 1 : h.includes('n') ? -1 : 0,
  }
}

const rad = (deg: number) => (deg * Math.PI) / 180
function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const r = rad(deg), c = Math.cos(r), s = Math.sin(r)
  return { x: x * c - y * s, y: x * s + y * c }
}
const round2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** 框收进范围（坐标、尺寸上下限·缺省＝简报资料契约）·两位小数 */
export function normalizeFrame(f: Frame, limits: FrameLimits = DEFAULT_FRAME_LIMITS): Frame {
  const L = limits
  return {
    x: round2(clamp(f.x, L.posMin, L.posMax)),
    y: round2(clamp(f.y, L.posMin, L.posMax)),
    w: round2(clamp(f.w, L.sizeMin, L.sizeMax)),
    h: round2(clamp(f.h, L.sizeMin, L.sizeMax)),
    rotate: normalizeAngle(f.rotate),
  }
}

/** 角度收进 [0, 360)·两位小数（与服务端 validate.normRotate 同口径·乐观更新与回包不跳） */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  const a = deg % 360
  const r = Math.round((a < 0 ? a + 360 : a) * 100) / 100
  return r >= 360 ? 0 : r
}

/**
 * 拖把手缩放。dx／dy＝指针位移（逻辑座标）。
 * 做法：位移转进框自己的座标系 → 按把手方向改宽高 → 对边（对角）那一点在页面上钉住 → 反推新框。
 */
export function resizeFrame(start: Frame, handle: Handle, dx: number, dy: number, opts: { keepRatio?: boolean; minSize?: number } = {}): Frame {
  const min = Math.max(DEFAULT_FRAME_LIMITS.sizeMin, opts.minSize ?? 4)
  const { hx, hy } = handleSign(handle)
  const local = rot(dx, dy, -start.rotate)
  let w = start.w + hx * local.x
  let h = start.h + hy * local.y
  if (opts.keepRatio && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h
    if (hx !== 0 && hy !== 0) {
      // 四角：取变化较大的一边为准
      const sw = w / start.w, sh = h / start.h
      const s = Math.abs(sw - 1) >= Math.abs(sh - 1) ? sw : sh
      w = start.w * s; h = start.h * s
    } else if (hx !== 0) {
      h = w / ratio
    } else {
      w = h * ratio
    }
  }
  w = Math.max(min, w)
  h = Math.max(min, h)
  // 钉住的那一点（框中心座标系）：对边中点或对角
  const cx0 = start.x + start.w / 2, cy0 = start.y + start.h / 2
  const a0 = rot((-hx * start.w) / 2, (-hy * start.h) / 2, start.rotate)
  const anchor = { x: cx0 + a0.x, y: cy0 + a0.y }
  const a1 = rot((-hx * w) / 2, (-hy * h) / 2, start.rotate)
  const cx = anchor.x - a1.x, cy = anchor.y - a1.y
  return normalizeFrame({ x: cx - w / 2, y: cy - h / 2, w, h, rotate: start.rotate })
}

/**
 * 旋转：指针相对框中心的角度（把手在框顶上方·所以 +90°）。
 * snapStep＝Shift 时 15；不按 Shift 时靠近 0／90／180／270 ±4° 自动吸。
 */
export function rotateFrame(start: Frame, pointer: { x: number; y: number }, opts: { step?: number } = {}): Frame {
  const cx = start.x + start.w / 2, cy = start.y + start.h / 2
  let deg = (Math.atan2(pointer.y - cy, pointer.x - cx) * 180) / Math.PI + 90
  if (opts.step && opts.step > 0) {
    deg = Math.round(deg / opts.step) * opts.step
  } else {
    const q = Math.round(deg / 90) * 90
    if (Math.abs(deg - q) <= 4) deg = q
  }
  return { ...start, rotate: normalizeAngle(deg) }
}

/** 框旋转后的外接矩形（吸附与参考线用） */
export function aabb(f: Frame): { left: number; top: number; right: number; bottom: number; cx: number; cy: number } {
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2
  if (!f.rotate) return { left: f.x, top: f.y, right: f.x + f.w, bottom: f.y + f.h, cx, cy }
  const r = rad(f.rotate), c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
  const hw = (f.w * c + f.h * s) / 2, hh = (f.w * s + f.h * c) / 2
  return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh, cx, cy }
}

export type Guide = { axis: 'x' | 'y'; at: number; from: number; to: number }

/**
 * 拖动＋吸附。page＝页面尺寸（吸页面边缘与中线）；others＝同页其他（没隐藏的）框。threshold＝逻辑座标（元件按屏幕 6px 换算后传入）。
 * 回：新框＋要画的参考线（只画真吸上的那几条）。
 */
export function moveFrame(page: PageSize, start: Frame, dx: number, dy: number, others: readonly Frame[], threshold: number, snap = true): { frame: Frame; guides: Guide[] } {
  const W = page.w, H = page.h
  let nx = start.x + dx, ny = start.y + dy
  const guides: Guide[] = []
  if (snap && threshold > 0) {
    const moved = aabb({ ...start, x: nx, y: ny })
    const xs: number[] = [0, W / 2, W]
    const ys: number[] = [0, H / 2, H]
    for (const o of others) {
      const b = aabb(o)
      xs.push(b.left, b.cx, b.right)
      ys.push(b.top, b.cy, b.bottom)
    }
    const pick = (mine: number[], targets: number[]): { delta: number; at: number } | null => {
      let best: { delta: number; at: number } | null = null
      for (const m of mine) for (const t of targets) {
        const d = t - m
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t }
      }
      return best
    }
    const sx = pick([moved.left, moved.cx, moved.right], xs)
    const sy = pick([moved.top, moved.cy, moved.bottom], ys)
    if (sx) nx += sx.delta
    if (sy) ny += sy.delta
    const fin = aabb({ ...start, x: nx, y: ny })
    const eps = 0.01
    if (sx) {
      // 同一条 x 上吸到的所有东西都画进参考线的范围里
      let from = fin.top, to = fin.bottom
      if (Math.abs(sx.at) < eps || Math.abs(sx.at - W) < eps || Math.abs(sx.at - W / 2) < eps) { from = 0; to = H }
      for (const o of others) {
        const b = aabb(o)
        if ([b.left, b.cx, b.right].some((v) => Math.abs(v - sx.at) < eps)) { from = Math.min(from, b.top); to = Math.max(to, b.bottom) }
      }
      guides.push({ axis: 'x', at: sx.at, from, to })
    }
    if (sy) {
      let from = fin.left, to = fin.right
      if (Math.abs(sy.at) < eps || Math.abs(sy.at - H) < eps || Math.abs(sy.at - H / 2) < eps) { from = 0; to = W }
      for (const o of others) {
        const b = aabb(o)
        if ([b.top, b.cy, b.bottom].some((v) => Math.abs(v - sy.at) < eps)) { from = Math.min(from, b.left); to = Math.max(to, b.right) }
      }
      guides.push({ axis: 'y', at: sy.at, from, to })
    }
  }
  return { frame: normalizeFrame({ ...start, x: nx, y: ny }), guides }
}

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

/** 方向键微调（1·Shift 10） */
export function nudgeFrame(start: Frame, key: ArrowKey, big: boolean): Frame {
  const d = big ? 10 : 1
  const dx = key === 'ArrowLeft' ? -d : key === 'ArrowRight' ? d : 0
  const dy = key === 'ArrowUp' ? -d : key === 'ArrowDown' ? d : 0
  return normalizeFrame({ ...start, x: start.x + dx, y: start.y + dy })
}

/** 把手的屏幕游标（框转过角度时按 45° 一格换游标） */
export function handleCursor(h: Handle, rotate: number): string {
  const order: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
  const i = order.indexOf(h)
  const k = (i + Math.round(normalizeAngle(rotate) / 45) + 8) % 8
  const cursors = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize']
  return cursors[k]
}

/** 两个框差在哪几个栏（只送改了的栏·PATCH 越小越好） */
export function framePatch(before: Frame, after: Frame): Partial<Frame> | null {
  const out: Partial<Frame> = {}
  for (const k of ['x', 'y', 'w', 'h', 'rotate'] as const) if (Math.abs(before[k] - after[k]) > 0.004) out[k] = after[k]
  return Object.keys(out).length ? out : null
}

/**
 * 把手中心落在页面范围内吗（逻辑坐标·含转角）。页面外的把手照样画出来，但不接滑鼠——
 * 否则伸出页面的那几颗会盖在页面外的清单／工具栏上抢点击。rotateGap＝旋转把手中心离框上缘多远（逻辑坐标＝屏幕 px ÷ 缩放）。
 */
export function handleOnPage(page: PageSize, f: Frame, h: Handle | 'rotate', rotateGap: number): boolean {
  let dx = 0, dy = -f.h / 2 - rotateGap
  if (h !== 'rotate') { const s = handleSign(h); dx = (s.hx * f.w) / 2; dy = (s.hy * f.h) / 2 }
  const o = rot(dx, dy, normalizeAngle(f.rotate))
  const px = f.x + f.w / 2 + o.x, py = f.y + f.h / 2 + o.y
  return px >= 0 && px <= page.w && py >= 0 && py <= page.h
}

/* ------------------------------------------------------------------ */
/* 多选：整组移动／等比缩放／绕中心旋转／排层级·拉框命中                    */
/* ------------------------------------------------------------------ */

export type IdFrame = { id: string; frame: Frame }

/** 一组框（含转角）的外接矩形＝整组的框（不转） */
export function groupBox(frames: readonly Frame[]): Frame {
  if (!frames.length) return { x: 0, y: 0, w: 0, h: 0, rotate: 0 }
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
  for (const f of frames) { const a = aabb(f); l = Math.min(l, a.left); t = Math.min(t, a.top); r = Math.max(r, a.right); b = Math.max(b, a.bottom) }
  return { x: l, y: t, w: r - l, h: b - t, rotate: 0 }
}

/** 方向键微调整组（每个都挪同样多） */
export function nudgeGroup(items: readonly IdFrame[], key: ArrowKey, big: boolean): IdFrame[] {
  return items.map((it) => ({ id: it.id, frame: nudgeFrame(it.frame, key, big) }))
}

/** 整组拖动：拿整组的框去吸附（与单个同一套），再把同一段位移套到每一个 */
export function moveGroup(page: PageSize, items: readonly IdFrame[], dx: number, dy: number, others: readonly Frame[], threshold: number, snap = true): { items: IdFrame[]; guides: Guide[] } {
  const box = groupBox(items.map((i) => i.frame))
  const r = moveFrame(page, box, dx, dy, others, threshold, snap)
  // moveFrame 会把框两位小数化·位移按原框差算
  const ddx = r.frame.x - round2(box.x), ddy = r.frame.y - round2(box.y)
  return { items: items.map((it) => ({ id: it.id, frame: normalizeFrame({ ...it.frame, x: it.frame.x + ddx, y: it.frame.y + ddy }) })), guides: r.guides }
}

/** 整组缩放（一律等比）：整组的框按把手缩，每个成员相对整组框的位置与大小同比例缩（转角不变） */
export function resizeGroup(items: readonly IdFrame[], start: Frame, handle: Handle, dx: number, dy: number): IdFrame[] {
  if (!(start.w > 0 && start.h > 0)) return items.map((i) => ({ ...i }))
  const nb = resizeFrame(start, handle, dx, dy, { keepRatio: true, minSize: 4 })
  const s = nb.w / start.w
  return items.map((it) => {
    const f = it.frame
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2
    const ncx = nb.x + (cx - start.x) * s, ncy = nb.y + (cy - start.y) * s
    const w = f.w * s, h = f.h * s
    return { id: it.id, frame: normalizeFrame({ x: ncx - w / 2, y: ncy - h / 2, w, h, rotate: f.rotate }) }
  })
}

/** 整组绕一点旋转 deg 度：每个成员的中心绕那点转、自己的角度也加 deg */
export function rotateGroup(items: readonly IdFrame[], center: { x: number; y: number }, deg: number): IdFrame[] {
  return items.map((it) => {
    const f = it.frame
    const c = rot(f.x + f.w / 2 - center.x, f.y + f.h / 2 - center.y, deg)
    return { id: it.id, frame: normalizeFrame({ ...f, x: center.x + c.x - f.w / 2, y: center.y + c.y - f.h / 2, rotate: f.rotate + deg }) }
  })
}

/** 旋转把手拖到 pointer 时整组要转几度（相对按下那一刻）·Shift 每 15° 一格 */
export function groupRotateDelta(center: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }, step = 0): number {
  const a0 = (Math.atan2(from.y - center.y, from.x - center.x) * 180) / Math.PI
  const a1 = (Math.atan2(to.y - center.y, to.x - center.x) * 180) / Math.PI
  let d = a1 - a0
  if (step > 0) d = Math.round(d / step) * step
  return d
}

/** 拉框（逻辑坐标·任意两角）⇒ 与框相交的编号（相交即算·含转角用外接矩形）·隐藏的与锁住的不算 */
export function marqueeHits(a: { x: number; y: number }, b: { x: number; y: number }, comps: readonly { id: string; frame: Frame; hidden?: boolean; locked?: boolean }[]): string[] {
  const l = Math.min(a.x, b.x), r = Math.max(a.x, b.x), t = Math.min(a.y, b.y), btm = Math.max(a.y, b.y)
  return comps.filter((c) => {
    if (c.hidden || c.locked) return false
    const q = aabb(c.frame)
    return q.left <= r && q.right >= l && q.top <= btm && q.bottom >= t
  }).map((c) => c.id)
}

/**
 * 整组排层级：回一串「把某个移到第 N 层」（数字 z·依序套上）⇒ 套完后被选的那几个整组上移／下移一层、到最上／最下，彼此的先后不变。
 * order＝本页现在的叠层（数组顺序·后面盖前面）。
 */
export function groupZMoves(order: readonly string[], selected: ReadonlySet<string>, z: ZDir): { id: string; z: number }[] {
  const want = groupZOrder(order, selected, z)
  const cur = [...order]
  const out: { id: string; z: number }[] = []
  for (let i = 0; i < want.length; i++) {
    if (cur[i] === want[i]) continue
    const from = cur.indexOf(want[i])
    cur.splice(from, 1)
    cur.splice(i, 0, want[i])
    out.push({ id: want[i], z: i })
  }
  return out
}

/** 整组排层级之后应有的叠层顺序 */
export function groupZOrder(order: readonly string[], selected: ReadonlySet<string>, z: ZDir): string[] {
  const sel = order.filter((id) => selected.has(id)), rest = order.filter((id) => !selected.has(id))
  if (z === 'top') return [...rest, ...sel]
  if (z === 'bottom') return [...sel, ...rest]
  const a = [...order]
  if (z === 'up') {
    for (let i = a.length - 2; i >= 0; i--) if (selected.has(a[i]) && !selected.has(a[i + 1])) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t }
  } else {
    for (let i = 1; i < a.length; i++) if (selected.has(a[i]) && !selected.has(a[i - 1])) { const t = a[i]; a[i] = a[i - 1]; a[i - 1] = t }
  }
  return a
}
