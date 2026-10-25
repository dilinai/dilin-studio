/**
 * 框层共用型别
 *
 * 从简报元件版（slide-kit/components/types.ts）抽出来·简报、云文档、云表格三处共用：
 *   · Frame：原点左上·旋转以框中心为轴顺时针·单位度；座标单位由宿主定（简报＝逻辑画布 1000×562.5；文档＝毫米；表格＝像素）。
 *   · 层次＝数组顺序（0 最底·后面盖前面）。
 */

export type Frame = { x: number; y: number; w: number; h: number; rotate: number }

/** 叠层方向：上移一层 up／下移一层 down／最顶 top／最底 bottom */
export type ZDir = 'top' | 'bottom' | 'up' | 'down'

/** 叠层移动：数字＝移到数组第几位（0 最底）；或 上移一层 up／下移一层 down／最顶 top／最底 bottom */
export type ZMove = number | ZDir

/** 页面（画布）尺寸·与 Frame 同单位 */
export type PageSize = { w: number; h: number }

/** 框收拢范围（坐标、尺寸上下限） */
export type FrameLimits = { posMin: number; posMax: number; sizeMin: number; sizeMax: number }

/** 缺省收拢范围＝简报资料契约（slide-kit COMPONENT_LIMITS 同值·transform.test 对过） */
export const DEFAULT_FRAME_LIMITS: FrameLimits = { posMin: -1000, posMax: 2000, sizeMin: 1, sizeMax: 3000 }
