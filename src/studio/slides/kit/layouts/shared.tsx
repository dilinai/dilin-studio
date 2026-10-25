/**
 * slide-kit · 版式共用件（画布壳/文字/图占位/母题装饰）
 *
 * 母题：全库统一「圆角面板 + 实心圆点标记」贯穿（认一个
 * 视觉母题重复到底）。🔴 禁标题下强调线（AI 味太重）。
 * 中文排版：正文行高 ≥1.5、标题 1.25-1.35、两端不硬断词。
 */

import * as React from 'react'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../types'
import type { SlidePalette } from '../themes'
import { fontStack } from '../themes'
import type { CropRect, LayoutLocale, Theme } from '../types'

/** 版式根容器：1000×562.5 逻辑画布 */
export function Canvas(props: {
  palette: SlidePalette
  theme: Theme
  children?: React.ReactNode
  style?: React.CSSProperties
}): React.JSX.Element {
  const { palette, theme, children, style } = props
  return (
    <div
      style={{
        position: 'relative',
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        overflow: 'hidden',
        background: palette.bg,
        color: palette.text,
        fontFamily: fontStack(theme.fontPair.body),
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** 多行截断（超出省略·防爆框；字号自适应是 S2 引擎的活，版式先保不溢出） */
export function clampStyle(lines: number): React.CSSProperties {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical' as const,
    WebkitLineClamp: lines,
    overflow: 'hidden',
  }
}

/** 标题字（heading 字体） */
export function headingStyle(theme: Theme, palette: SlidePalette, size: number): React.CSSProperties {
  return {
    fontFamily: fontStack(theme.fontPair.heading),
    fontWeight: 700,
    fontSize: size,
    lineHeight: 1.3,
    color: palette.text,
    margin: 0,
  }
}

/** 正文字（中文行高 1.6） */
export function bodyStyle(palette: SlidePalette, size: number): React.CSSProperties {
  return {
    fontSize: size,
    lineHeight: 1.6,
    color: palette.muted,
    margin: 0,
  }
}

/** 母题·实心圆点标记（替代强调线的分隔/点睛件） */
export function Dot(props: { palette: SlidePalette; size?: number }): React.JSX.Element {
  const s = props.size ?? 10
  return (
    <span
      style={{
        display: 'inline-block',
        width: s,
        height: s,
        borderRadius: '50%',
        background: props.palette.accent,
        flexShrink: 0,
      }}
    />
  )
}

/** 编号圆章（itemNumber/partNumber 槽的统一渲法） */
export function NumberBadge(props: {
  palette: SlidePalette
  label: string
  size?: number
  fontSize?: number
}): React.JSX.Element {
  const { palette, label } = props
  const s = props.size ?? 40
  return (
    <div
      style={{
        width: s,
        height: s,
        borderRadius: s * 0.28,
        background: palette.accent,
        color: palette.onAccent,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: props.fontSize ?? s * 0.42,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {label}
    </div>
  )
}

/**
 * crop 可渲判据：四值有限数·窗宽高 (0,100]·原点非负·窗不出原图。
 * JSON 落库回读/JS 边界传来的坏形状（NaN/0 宽/越界）一律不套用——
 * 落回 object-fit:cover 原行为（保守不裂图·与 crop 缺省同路径）。
 */
export function isRenderableCrop(c: CropRect | undefined): c is CropRect {
  if (!c || typeof c !== 'object') return false
  const { x, y, w, h } = c
  const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  if (!fin(x) || !fin(y) || !fin(w) || !fin(h)) return false
  return w > 0 && w <= 100 && h > 0 && h <= 100 && x >= 0 && y >= 0 && x + w <= 100.001 && y + h <= 100.001
}

/**
 * 百分比裁剪窗 → img inset 样式：让 crop 窗恰好铺满容器。
 * 图宽 = 容器宽×(100/w)，左移 = 窗左缘在图内占比 × 图宽 ⇒ left = -x/w×100%（相对容器）。
 * 容器需 overflow:hidden + position:relative/absolute（Figure/背景包壳都满足）。
 */
export function cropInsetStyle(crop: CropRect): React.CSSProperties {
  return {
    position: 'absolute',
    display: 'block',
    maxWidth: 'none',
    width: `${10000 / crop.w}%`,
    height: `${10000 / crop.h}%`,
    left: `${(-crop.x * 100) / crop.w}%`,
    top: `${(-crop.y * 100) / crop.h}%`,
  }
}

/**
 * 图槽：有 url 渲图·缺图渲主题化占位（渐变+圆点母题），绝不裂图。
 * crop（S2 图池匹配产出）合法时按百分比 inset 精确套用——
 * 比例不合的图裁到槽比例·不再退化成默认中心 cover；缺/非法 crop 走原 cover 路径（零回归）。
 */
export function Figure(props: {
  palette: SlidePalette
  url?: string
  crop?: CropRect
  radius?: number
  style?: React.CSSProperties
}): React.JSX.Element {
  const { palette, url, crop, style } = props
  const radius = props.radius ?? 16
  if (url) {
    return (
      <div
        style={{
          borderRadius: radius,
          overflow: 'hidden',
          position: 'relative',
          ...style,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          style={
            isRenderableCrop(crop)
              ? cropInsetStyle(crop)
              : { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
          }
        />
      </div>
    )
  }
  return (
    <div
      style={{
        borderRadius: radius,
        background: `linear-gradient(135deg, ${palette.figureBg} 0%, ${palette.surface} 100%)`,
        border: `1px solid ${palette.border}`,
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: '-12%',
          bottom: '-22%',
          width: '55%',
          aspectRatio: '1',
          borderRadius: '50%',
          background: palette.accent,
          opacity: 0.16,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '8%',
          top: '10%',
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: palette.accent,
          opacity: 0.55,
        }}
      />
    </div>
  )
}

/** 两位数编号文本（01 / 02 …） */
export function pad2(n: number): string {
  return String(n + 1).padStart(2, '0')
}

/**
 * 脏 deck_data 防御：读侧 SlideView 直渲存库 draft **不经引擎校验**
 * （回滚/复制/直改库来的脏 deck_data 直达版式）——非字符串 child 进 React SSR 会
 * 整页 throw（Objects are not valid as a React child）。版式取值一律过这两个帮手：
 * 必填字段非字符串 → ''（渲空不崩）；可选字段非字符串 → undefined（按缺省分支走）。
 */
export function textOr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 可选文本字段防御（见 {@link textOr}）：非字符串 → undefined */
export function optText(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/**
 * 版式静态文案三语表：目录标题/致谢默认语等版式 chrome
 * 不来自 AI draft·必须跟 locale 走——否则 lang:'zh-CN' 的简报仍出繁体静态字。
 */
export const CHROME_TEXT: Record<LayoutLocale, { contents: string; contentsEyebrow: string; thanks: string }> = {
  'zh-TW': { contents: '目錄', contentsEyebrow: 'CONTENTS', thanks: '謝謝觀看' },
  'zh-CN': { contents: '目录', contentsEyebrow: 'CONTENTS', thanks: '谢谢观看' },
  en: { contents: 'Contents', contentsEyebrow: 'CONTENTS', thanks: 'Thank You' },
}

/** 取静态文案（缺省 zh-TW=既有调用零变化·未知值兜底 zh-TW 不 throw） */
export function chromeText(locale?: LayoutLocale): (typeof CHROME_TEXT)['zh-TW'] {
  return CHROME_TEXT[locale ?? 'zh-TW'] ?? CHROME_TEXT['zh-TW']
}
