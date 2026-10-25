'use client'
// 网页剪辑页·一段字照花字款式画出来（花字库）：那支 fancyToCss 的层叠画法（阴影层→描边层→字面层叠在同一格）。
// 播放器叠字与花字库款式格共用；字号由外层给（style.fontSize）·款式里全用 em。
// 文字栏：look＝行高／多行对齐／底线（resolveTextLook 算的·汇出 text-draw.ts 照同一份画）·缺＝照旧。
// 文字动画：reveal＝看得到前几个字（打字机类·换行不算字）·后面的字照样占位置只是藏起来（字不跳位·汇出同一套）·缺＝全部。
import type { CSSProperties } from 'react'
import { fancyToCss, type FancyStyle } from '../lib/fancy-text.data'
import { UNDERLINE } from '../lib/text-style.pure'
import { revealCut } from '../lib/text-anim.pure'
import type { TextAlign } from '../lib/timeline.pure'

export type FancyTextLook = { lineHeight?: number; align?: TextAlign; underline?: string | null }

export default function VeditFancyText({ text, fancy, style, className, testid, look, reveal, perChar }: { text: string; fancy: FancyStyle; style?: CSSProperties; className?: string; testid?: string; look?: FancyTextLook; reveal?: number; perChar?: ReadonlyArray<{ transform: string; opacity: number }> }) {
  const css = fancyToCss(fancy)
  const ex: CSSProperties = { ...(look?.lineHeight ? { lineHeight: String(look.lineHeight) } : {}), ...(look?.align ? { textAlign: look.align } : {}) }
  // 底线只画在字面层（颜色另给·字面层 color 是透明的）；阴影层、描边层不带
  const under: CSSProperties = look?.underline ? { textDecorationLine: 'underline', textDecorationColor: look.underline, textDecorationThickness: `${UNDERLINE.thickness}em`, textUnderlineOffset: `${UNDERLINE.offset}em` } : {}
  const cut = reveal === undefined ? text.length : revealCut(text, reveal)
  // 逐字动画：每个字（换行不算）一格 inline-block·套 charCss（汇出 text-draw.ts 同一份 charMatrix）
  let pi = 0
  const body = perChar ? Array.from(text).map((ch, k) => ch === '\n' ? ch : <span key={k} data-testid="vedit-text-char" style={{ display: 'inline-block', whiteSpace: 'pre', transformOrigin: 'center', ...(perChar[pi++] ?? {}) }}>{ch}</span>)
    : cut >= text.length ? text : <>{text.slice(0, cut)}<span style={{ visibility: 'hidden' }}>{text.slice(cut)}</span></>
  return (
    <span className={className} style={{ ...(css.box as CSSProperties), ...ex, ...style }} data-testid={testid}>
      {css.layers.map((l, i) => <span key={i} style={{ ...(l as CSSProperties), ...ex, ...(i === css.layers.length - 1 ? under : {}) }} aria-hidden={i < css.layers.length - 1}>{body}</span>)}
      {/* 气泡尾巴（汇出 drawBubbleTail 照同一份） */}
      {css.tails.map((tl, i) => <span key={`t${i}`} style={tl as CSSProperties} aria-hidden data-testid="vedit-bubble-tail" />)}
    </span>
  )
}
