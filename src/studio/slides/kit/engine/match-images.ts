/**
 * slide-kit engine · 图池比例匹配 + 百分比居中裁剪
 *
 * 算法思想出处：参考 PPTist（挑比例最近的图 + 百分比居中裁剪·转述思路自研）。
 *   - 每个图槽按「槽位期望宽高比」在图池里挑比例最接近的一张。
 *   - 比例不合 → 产出百分比居中裁剪参数（图不变形·槽不留白）·由渲染/导出侧套用。
 *   - 同页多槽尽量不重图（图池够大时优先未用过的·不够则允许复用）。
 *
 * 纯函数确定性：同图池同槽表必同结果（并列取池内靠前者·不掷随机）。
 * 槽位真实像素尺寸埋在版式组件内部（LayoutMeta 无坐标）·此处用「槽型默认宽高比」
 * 近似（background=画布 16:9·pageFigure 竖向侧栏·itemFigure 横卡）·可经 options 覆盖。
 */

import type { CropRect, ImageSlotType, LayoutMeta } from '../types'
import { CANVAS_HEIGHT, CANVAS_WIDTH, imageSlotKey } from '../types'

/** 图池素材（比例来自显式 aspect 或 width/height·都缺按 DEFAULT_IMAGE_ASPECT） */
export type ImageAsset = {
  url: string
  width?: number
  height?: number
  /** 显式宽高比（w/h）·给到就不看 width/height */
  aspect?: number
}

/** 百分比裁剪窗（0~100·相对原图·居中）——定义收在 types（渲染侧同源消费） */
export type { CropRect }

/** 槽位映射结果（ComposedPage.images 的值型） */
export type SlotImage = { url: string; crop?: CropRect }

/** 素材缺尺寸时的兜底比例（4:3 通用横图） */
export const DEFAULT_IMAGE_ASPECT = 4 / 3

/** 槽型默认期望宽高比（LayoutMeta 无坐标·工程近似·options 可覆盖） */
export const DEFAULT_SLOT_ASPECTS: Record<ImageSlotType, number> = {
  background: CANVAS_WIDTH / CANVAS_HEIGHT, // 全幅 16:9
  pageFigure: 0.9, // 侧栏立图（cover-split/content-split 右柱近似）
  itemFigure: 1.33, // 条目横卡
}

/** 比例差在此容差内视为相同 → 不出裁剪参数 */
const ASPECT_EPSILON = 0.01

export type MatchImagesOptions = {
  /** 覆盖槽型期望比例（按需部分覆盖） */
  slotAspects?: Partial<Record<ImageSlotType, number>>
  /**
   * 当前页真实条目数（-）：itemFigure 槽实例只展开到
   * min(版式容量, itemCount)——4 槽版式承载 3 条时不给不存在的第 4 条产图映射
   * （imageSlotKey 'itemFigure:i' 按条目序号对位·多产=渲染侧空槽/错槽）。
   * 缺省（undefined）按版式容量全量展开（独立调用无 draft 上下文时的兼容行为）。
   */
  itemCount?: number
}

/** 数值是有限正数（比例合法性判据·-） */
function isFinitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * 素材宽高比（aspect > width/height > 兜底）。
 * 🔴 只认**有限正数**（-）：`aspect: Infinity`/NaN·或
 * width/height 带 Infinity 会让 centerCrop 产出 w:0 裁剪窗（渲染成空图）——
 * 非法比例一律落 DEFAULT_IMAGE_ASPECT。
 */
export function assetAspect(a: ImageAsset): number {
  if (isFinitePositive(a.aspect)) return a.aspect
  if (isFinitePositive(a.width) && isFinitePositive(a.height)) return a.width / a.height
  return DEFAULT_IMAGE_ASPECT
}

/**
 * 百分比居中裁剪：把 imageAspect 的图裁成 slotAspect。
 * 比例已近似相同返回 undefined（整图可用·免裁）。
 */
export function centerCrop(imageAspect: number, slotAspect: number): CropRect | undefined {
  // 非有限比例（Infinity/NaN）会算出 w:0 或 h:0 的空裁剪窗→ 整图免裁
  if (!isFinitePositive(imageAspect) || !isFinitePositive(slotAspect)) return undefined
  if (Math.abs(imageAspect - slotAspect) < ASPECT_EPSILON) return undefined
  if (imageAspect > slotAspect) {
    // 图比槽宽 → 裁左右·全高
    const w = (slotAspect / imageAspect) * 100
    return { x: (100 - w) / 2, y: 0, w, h: 100 }
  }
  // 图比槽窄（高）→ 裁上下·全宽
  const h = (imageAspect / slotAspect) * 100
  return { x: 0, y: (100 - h) / 2, w: 100, h }
}

/**
 * 为一个版式的全部图槽从图池挑图。
 * 返回 ComposedPage.images 形状（键按 imageSlotKey 约定）；
 * 图池空/版式无图槽返回 undefined（渲染层走占位块路径）。
 */
export function matchImages(
  meta: LayoutMeta,
  pool: ImageAsset[],
  opts: MatchImagesOptions = {},
): Record<string, SlotImage> | undefined {
  // 🔴 运行时非法输入吞错不 throw（-）：JS 边界传
  // 字符串 / {length:1} 类 array-like → 原 pool.filter 抛 TypeError 破契约。
  // Array.isArray 挡非数组·filter 内先挡 null/非对象元素再读 .url。
  if (!Array.isArray(pool)) return undefined
  const usable = pool.filter(
    (a): a is ImageAsset =>
      !!a && typeof a === 'object' && typeof a.url === 'string' && a.url.length > 0,
  )
  if (usable.length === 0) return undefined

  // 🔴 slotAspects 覆盖值只认有限正数：Infinity/NaN 混进期望比例会让
  // pickNearest 全员 diff=Infinity 挑不出图（best=-1 → 越界读 throw 破契约）·非法覆盖忽略
  const aspects = { ...DEFAULT_SLOT_ASPECTS }
  if (opts.slotAspects) {
    for (const k of Object.keys(DEFAULT_SLOT_ASPECTS) as ImageSlotType[]) {
      const v = opts.slotAspects[k]
      if (isFinitePositive(v)) aspects[k] = v
    }
  }

  /* 需要填的槽实例展开（itemFigure 按 min(容量, 真实条目数) 展开） */
  const wanted: Array<{ key: string; aspect: number }> = []
  const slotOrder: ImageSlotType[] = ['background', 'pageFigure', 'itemFigure']
  for (const slot of slotOrder) {
    const cap = meta.slots.image[slot]
    if (cap <= 0) continue
    if (slot === 'itemFigure') {
      const n =
        typeof opts.itemCount === 'number' && opts.itemCount >= 0
          ? Math.min(cap, Math.floor(opts.itemCount))
          : cap
      for (let i = 0; i < n; i++) wanted.push({ key: imageSlotKey(slot, i), aspect: aspects[slot] })
    } else {
      wanted.push({ key: imageSlotKey(slot), aspect: aspects[slot] })
    }
  }
  if (wanted.length === 0) return undefined

  const used = new Set<number>()
  const out: Record<string, SlotImage> = {}
  for (const { key, aspect } of wanted) {
    const idx = pickNearest(usable, aspect, used)
    used.add(idx)
    const asset = usable[idx]
    const crop = centerCrop(assetAspect(asset), aspect)
    out[key] = crop ? { url: asset.url, crop } : { url: asset.url }
  }
  return out
}

/** 池内挑比例最近的一张：先在未用过的里挑·全用过了允许复用（并列取靠前） */
function pickNearest(pool: ImageAsset[], slotAspect: number, used: Set<number>): number {
  let best = -1
  let bestDiff = Infinity
  const consider = (i: number) => {
    const diff = Math.abs(assetAspect(pool[i]) - slotAspect)
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  }
  for (let i = 0; i < pool.length; i++) if (!used.has(i)) consider(i)
  if (best === -1) for (let i = 0; i < pool.length; i++) consider(i)
  // 双保险：diff 全为 Infinity/NaN 时 best 仍是 -1（越界读会 throw）→ 取首张
  return best === -1 ? 0 : best
}
