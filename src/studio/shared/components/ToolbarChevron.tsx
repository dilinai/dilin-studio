'use client'
// 工具栏下拉共用小箭头（字体「預設」、字号「11」、数字格式「常規」三颗箭头原本歪——
//   原生 <select> 的箭头各家浏览器位置不一 ⇒ 一律 appearance-none 把原生箭头关掉·右侧自绘同一颗 chevron：
//   固定右内边距（pr-6·箭头占 right-1.5）·绝对定位垂直居中·同款同高。三处（字体／字号／数字格式）都用这一份。
//   字体下拉（FontFamilyDropdown·自绘钮）用 ToolbarChevron 单颗；原生 <select>（字号）用 SelectWithChevron 包；数字格式钮也是单颗。别再各画一颗。
//   放 studio/shared 是因为几个编辑器都用。
import type { ReactNode, SelectHTMLAttributes } from 'react'

/** 那颗箭头（w-3 h-3·stroke 2·灰）——放在 relative 容器里·右 6px·垂直居中·不吃点击 */
export function ToolbarChevron({ className = '' }: { className?: string }) {
  return (
    <svg data-testid="tb-chevron" aria-hidden="true" className={`pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 ${className}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/** 下拉外壳：h-7 边框圆角白底·统一字号色·右侧留箭头位（三处同款） */
export const TOOLBAR_SELECT_CLASS = 'appearance-none h-7 text-xs border border-gray-200 rounded bg-white pl-1.5 pr-6 text-gray-700 disabled:opacity-40 w-full'

type Props = SelectHTMLAttributes<HTMLSelectElement> & { wrapClassName?: string; children: ReactNode }
/** 原生 <select>＋自绘箭头：appearance-none 关掉原生箭头·箭头绝对定位在右·外层 relative 容器定宽（wrapClassName 给 w-[…]） */
export function SelectWithChevron({ wrapClassName = '', className = '', children, ...rest }: Props) {
  return (
    <div className={`relative inline-block shrink-0 ${wrapClassName}`}>
      <select {...rest} className={`${TOOLBAR_SELECT_CLASS} ${className}`}>{children}</select>
      <ToolbarChevron />
    </div>
  )
}
