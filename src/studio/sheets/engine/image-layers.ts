// 表格浮图的层次与平面
//   纯函数·网格右键选单与单测共用：
//   - 层次＝images 数组顺序（0 最底）；三个平面各排各的：below（格子之下）／cell（放进格子里）／above（格子之上·缺省）
//     上移下移＝跟「同平面里」相邻那张换位（跨平面换位画面上看不出差别·徒增一步撤销）
//   - 换平面：移到表格底下／上面＝改 plane 并排到新平面的最顶；放进格子里＝inCell:true（cell 不变·ox/oy 清掉）
//   ⛔ 图层视窗
import type { SheetImage, SheetImagePlane } from './style'

export type ImageLayer = 'below' | 'cell' | 'above'
export type ZMove = 'up' | 'down' | 'top' | 'bottom'

export const imageLayer = (im: SheetImage): ImageLayer => (im.inCell ? 'cell' : im.plane === 'below' ? 'below' : 'above')

/** 同平面里移层次；动不了（已到顶／底·找不到）⇒ 回原数组（同一参照·调用方据此不进撤销栈） */
export function moveImageZ(images: SheetImage[], id: string, move: ZMove): SheetImage[] {
  const i = images.findIndex(im => im.id === id)
  if (i < 0) return images
  const layer = imageLayer(images[i])
  const same = images.map((im, k) => (imageLayer(im) === layer ? k : -1)).filter(k => k >= 0)   // 同平面各张在数组里的位置（由底到顶）
  const at = same.indexOf(i)
  const to = move === 'up' ? at + 1 : move === 'down' ? at - 1 : move === 'top' ? same.length - 1 : 0
  if (to < 0 || to >= same.length || to === at) return images
  // 同平面那几格按新顺序重排·别的平面原位不动
  const order = same.map(k => images[k])
  const [it] = order.splice(at, 1)
  order.splice(to, 0, it)
  const out = images.slice()
  same.forEach((k, n) => { out[k] = order[n] })
  return out
}

/** 能不能往某方向移（选单灰掉用） */
export function canMoveImageZ(images: SheetImage[], id: string, move: ZMove): boolean {
  return moveImageZ(images, id, move) !== images
}

/** 移到表格底下／上面（格内图也可移出来·浮在原格左上）；已在该平面 ⇒ 原数组 */
export function setImagePlane(images: SheetImage[], id: string, plane: SheetImagePlane): SheetImage[] {
  const i = images.findIndex(im => im.id === id)
  if (i < 0) return images
  const cur = images[i]
  if (!cur.inCell && (cur.plane === 'below' ? 'below' : 'above') === plane) return images
  const { plane: _p, inCell: _c, ...rest } = cur
  const next: SheetImage = plane === 'below' ? { ...rest, plane: 'below' } : { ...rest }
  return [...images.slice(0, i), ...images.slice(i + 1), next]   // 排到最后＝新平面的最顶
}

/** 放进格子里（随格大小·cell 不变）；已是格内图 ⇒ 原数组 */
export function putImageInCell(images: SheetImage[], id: string): SheetImage[] {
  const i = images.findIndex(im => im.id === id)
  if (i < 0 || images[i].inCell) return images
  const { plane: _p, ox: _x, oy: _y, ...rest } = images[i]
  const next: SheetImage = { ...rest, inCell: true }
  // 同一格只留一张格内图（Excel 一格一个值）：那格原有的格内图移出来浮在格上
  const out = images.map((im, k) => (k !== i && im.inCell && im.cell === next.cell ? (({ inCell: _q, ...r }) => r as SheetImage)(im) : im))
  out[i] = next
  return out
}
