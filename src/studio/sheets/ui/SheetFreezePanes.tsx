'use client'
// 冻结窗格的画法
//   格子：冻结区的格（含行号／列头）用 position: sticky 钉住——top／left＝它本来的位置（量出的几何 ÷ 缩放·表格 CSS zoom 会把 sticky 偏移一起乘回去）
//     ⇒ 卷动前后都不跳；冻结格垫白底（不然底下卷过去的格透出来）。
//   覆盖层（框线／选区框／填充柄／引用框）：本来只有一层跟着内容卷（裁掉表头那条）——冻结后另画三块「窗格」：
//     上（冻结行×可卷列）只跟着左右卷·左（可卷行×冻结列）只跟着上下卷·角（两者都冻）不动；各自裁到自己那块（CSS 变数 --sx／--sy＝卷动量·不重渲染）。
//   主层的裁切（--ov-top／--ov-left）由 SheetGrid 加上冻结区的高宽。
import type { CSSProperties, ReactNode } from 'react'
import { colWidthOf, rowHeightOf } from '../engine/layout'

type Geo = { colL: number[]; colR: number[]; rowT: number[]; rowB: number[] }
export type FreezeBox = { fr: number; fc: number; frozenH: number; frozenW: number; rowT0: number; colL0: number }

/** 冻结区在内容座标里的高宽（已含缩放）·没冻 ⇒ 0 */
export function freezeBox(geo: Geo | null, fr: number, fc: number): FreezeBox {
  const rowT0 = geo?.rowT[0] ?? 0, colL0 = geo?.colL[0] ?? 0
  const frozenH = geo && fr > 0 && geo.rowB[fr - 1] !== undefined ? geo.rowB[fr - 1] - rowT0 : 0
  const frozenW = geo && fc > 0 && geo.colR[fc - 1] !== undefined ? geo.colR[fc - 1] - colL0 : 0
  return { fr, fc, frozenH, frozenW, rowT0, colL0 }
}

/** 冻结格的 sticky 样式（不在冻结区 ⇒ null）·kind：cell＝资料格／rowHead＝行号／colHead＝列头 */
export function frozenStyle(kind: 'cell' | 'rowHead' | 'colHead', r: number, c: number, fr: number, fc: number, geo: Geo | null, zoom: number, sizes: { headW: number; headH: number; colWidths?: Record<string, number>; rowHeights?: Record<string, number>; hiddenRows?: ReadonlySet<number>; hiddenCols?: ReadonlySet<number> }): CSSProperties | null {
  const inR = kind !== 'colHead' && r < fr, inC = kind !== 'rowHead' && c < fc
  if (!inR && !inC) return null
  // 还没量到几何（第一拍）⇒ 照行高栏宽累加·藏的行／栏算 0
  const top = () => { if (geo?.rowT[r] !== undefined) return geo.rowT[r] / zoom; let y = sizes.headH; for (let i = 0; i < r; i++) if (!sizes.hiddenRows?.has(i)) y += rowHeightOf(sizes.rowHeights, i); return y }
  const left = () => { if (geo?.colL[c] !== undefined) return geo.colL[c] / zoom; let x = sizes.headW; for (let i = 0; i < c; i++) if (!sizes.hiddenCols?.has(i)) x += colWidthOf(sizes.colWidths, i); return x }
  // 格线：border-collapse 下 sticky 格的框线留在原位不跟着走（钉住后边上一条缝会透出底下卷过去的字）⇒ 用外扩 1px 同色阴影补线盖缝；
  //   冻结区最后一行下缘／最后一列右缘另加一条深灰分隔线（Excel 冻结线）
  const line = ['0 0 0 1px #e5e7eb', inR && r === fr - 1 ? '0 1.5px 0 0 #9ca3af' : '', inC && c === fc - 1 ? '1.5px 0 0 0 #9ca3af' : ''].filter(Boolean).join(', ')
  if (kind === 'rowHead') return { position: 'sticky', top: top(), left: 0, zIndex: 11, boxShadow: line }
  if (kind === 'colHead') return { position: 'sticky', left: left(), zIndex: 25, boxShadow: line }
  return { position: 'sticky', ...(inR ? { top: top() } : {}), ...(inC ? { left: left() } : {}), zIndex: inR && inC ? 7 : 6, boxShadow: line }
}

/** 三块冻结窗格的覆盖层（render＝画一份 GridOverlay·clip 关掉它自己的主层裁切） */
export function FrozenOverlayPanes({ box, width, height, render }: { box: FreezeBox; width: number; height: number; render: () => ReactNode }) {
  const { fr, fc, frozenH, frozenW, rowT0, colL0 } = box
  if (!(fr > 0 && frozenH > 0) && !(fc > 0 && frozenW > 0)) return null
  const bottom = `${Math.max(0, height - (rowT0 + frozenH))}px`, right = `${Math.max(0, width - (colL0 + frozenW))}px`
  const pane = (key: string, transform: string, clipPath: string) => (
    <div key={key} data-testid={`sheet-freeze-pane-${key}`} className="absolute left-0 top-0 pointer-events-none z-[8]" style={{ width, height, transform, clipPath }}>{render()}</div>
  )
  return (
    <>
      {fr > 0 && frozenH > 0 && pane('top', 'translate(0, var(--sy, 0px))', `inset(${rowT0}px 0 ${bottom} var(--ov-left, 0px))`)}
      {fc > 0 && frozenW > 0 && pane('left', 'translate(var(--sx, 0px), 0)', `inset(var(--ov-top, 0px) ${right} 0 ${colL0}px)`)}
      {fr > 0 && fc > 0 && frozenH > 0 && frozenW > 0 && pane('corner', 'translate(var(--sx, 0px), var(--sy, 0px))', `inset(${rowT0}px ${right} ${bottom} ${colL0}px)`)}
    </>
  )
}

/**
 * 量出的几何修正（SheetGrid measure 量完调一次·就地改）：
 *   冻结的行号／列头是 sticky——卷动后量到的是钉住的位置 ⇒ 用第一条没冻结（量得准）的那条往回推（各条高宽不受 sticky 影响）；
 *   被筛掉／手动藏的行、手动藏的栏（display:none）量出来全是 0 ⇒ 当零高零宽、贴在上一条后缘。没冻结也没藏 ⇒ 一个数都不动。
 */
export function fixFrozenGeo(tb: HTMLElement, g: Geo, fz: { fr: number; fc: number }): void {
  // 行（被筛掉／手动藏的行）与栏（手动藏的栏：列头 th display:none）同一套：冻结的往回推·藏的当零宽贴在前一条后缘（打头就藏 ⇒ 贴在第一条看得见的前缘）
  const fix = (sel: string, L: number[], R: number[], frozen: number, size: (r: DOMRect) => number) => {
    const rr = Array.from(tb.querySelectorAll<HTMLElement>(sel)).map(th => th.getBoundingClientRect())
    const hidden = rr.map(r => !(r.width > 0 || r.height > 0))
    let fixedTo = 0
    if (frozen > 0) {
      let j = frozen
      while (j < rr.length && hidden[j]) j++
      if (j < rr.length) {
        let y = L[j]
        for (let i = j - 1; i >= 0; i--) { const h = hidden[i] ? 0 : size(rr[i]); R[i] = y; L[i] = y - h; y = L[i] }
        fixedTo = j
      }
    }
    const first = hidden.indexOf(false)
    for (let i = fixedTo; i < rr.length; i++) if (hidden[i]) { const y = i > 0 && i > first ? R[i - 1] : first >= 0 ? L[first] : L[i]; L[i] = y; R[i] = y }
  }
  fix('th[data-row]', g.rowT, g.rowB, fz.fr, r => r.height)
  fix('th[data-col]', g.colL, g.colR, fz.fc, r => r.width)
}
