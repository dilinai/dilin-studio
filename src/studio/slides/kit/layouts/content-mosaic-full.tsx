/**
 * slide-kit · 新增内容版式 ×5（React 版式）
 *   content-mosaic / content-cards-flow / content-fullbleed-glass / content-fullbleed-quote / content-fullbleed-cols
 * 版式构成与出处见 components/blueprints-mosaic-full.ts 档头。
 *
 * 写法：坐标只算一处（蓝图）——本档拿同一份组件清单、用旧版式的件（Canvas／Figure／色板）逐个画成绝对定位的 DOM，
 * 旧入口 SlideView 与组件化 ComponentSlideView 两边同一套框（components-parity 验 ≤8px）；颜色经 resolveColor 吃主题记号。
 * meta.relation 有值＝「新版式」：现行 pickLayout／paginate 跳过（只给指名／换版式用·relation 选版式接上前不改既有分页与选版）。
 */

import * as React from 'react'
import type { LayoutEntry, LayoutProps } from '../types'
import { makeSlotTable } from '../types'
import { resolvePalette } from '../themes'
import { Canvas, Figure } from './shared'
import { resolveColor, resolveFontStack, type ResolveCtx } from '../components/resolve'
import {
  contentCardsFlow,
  contentFullbleedCols,
  contentFullbleedGlass,
  contentFullbleedQuote,
  contentMosaic,
  MOSAIC_CAP,
} from '../components/blueprints-mosaic-full'
import type { BlueprintInput } from '../components/blueprints'
import type { ShapeComponent, SlideComponent, TextBody } from '../components/types'

/* ---------------- 组件清单 ⇒ 版式 DOM（只认本档蓝图用得到的几种） ---------------- */

function TextBox(props: { body: TextBody; ctx: ResolveCtx }): React.JSX.Element {
  const { body, ctx } = props
  const b = body.box
  const content = body.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n')
  return (
    <div
      style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        justifyContent: b.valign === 'middle' ? 'center' : b.valign === 'bottom' ? 'flex-end' : 'flex-start',
        fontFamily: resolveFontStack(b.font, ctx), fontSize: b.size, fontWeight: b.bold ? 700 : 400,
        lineHeight: b.lineHeight, color: resolveColor(b.color, ctx, ctx.palette.text),
        ...(b.letterSpacing ? { letterSpacing: b.letterSpacing } : {}),
        whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
      }}
    >
      <div
        style={{
          margin: 0, textAlign: b.align === 'distribute' ? 'justify' : b.align,
          ...(b.maxLines ? { display: '-webkit-box', WebkitBoxOrient: 'vertical' as const, WebkitLineClamp: b.maxLines, overflow: 'hidden' } : {}),
        }}
      >
        {content}
      </div>
    </div>
  )
}

function ShapeBox(props: { c: ShapeComponent; ctx: ResolveCtx }): React.JSX.Element {
  const { c, ctx } = props
  const { w, h } = c.frame
  const radius = c.shape === 'ellipse' ? '50%' : c.shape === 'roundRect' ? (c.radius ?? Math.min(w, h) * 0.15) : 0
  if (c.shape === 'line') {
    const sw = c.stroke?.width ?? 2
    const sc = resolveColor(c.stroke?.color, ctx, ctx.palette.border)
    const L = Math.max(8, sw * 4), Wd = Math.max(5, sw * 2.5), y = h / 2
    const endArrow = c.lineEnds?.end === 'arrow'
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <line x1={0} y1={y} x2={w - (endArrow ? L * 0.8 : 0)} y2={y} stroke={sc} strokeWidth={sw} />
        {endArrow ? <polygon points={`${w},${y} ${w - L},${y - Wd} ${w - L},${y + Wd}`} fill={sc} /> : null}
      </svg>
    )
  }
  const g = c.fillMode === 'gradient' && c.gradient && c.gradient.stops.length >= 2 ? c.gradient : null
  const background = g
    ? `linear-gradient(${(g.angle + 90) % 360}deg, ${g.stops.map((s) => `${resolveColor(s.color, ctx, 'transparent')} ${s.pos}%`).join(', ')})`
    : c.fill ? resolveColor(c.fill, ctx) : undefined
  return (
    <>
      {c.backdropBlur ? (
        <div style={{ position: 'absolute', inset: 0, borderRadius: radius, backdropFilter: `blur(${c.backdropBlur}px)`, WebkitBackdropFilter: `blur(${c.backdropBlur}px)` }} />
      ) : null}
      {background ? <div style={{ position: 'absolute', inset: 0, borderRadius: radius, background }} /> : null}
      {c.stroke && c.stroke.width > 0 ? (
        <div style={{ position: 'absolute', inset: 0, boxSizing: 'border-box', borderRadius: radius, border: `${c.stroke.width}px solid ${resolveColor(c.stroke.color, ctx)}` }} />
      ) : null}
      {c.text ? <TextBox body={c.text} ctx={ctx} /> : null}
    </>
  )
}

function Piece(props: { c: SlideComponent; ctx: ResolveCtx }): React.JSX.Element | null {
  const { c, ctx } = props
  const f = c.frame
  const box: React.CSSProperties = {
    position: 'absolute', left: f.x, top: f.y, width: f.w, height: f.h,
    ...(typeof c.opacity === 'number' && c.opacity < 1 ? { opacity: c.opacity } : {}),
  }
  let inner: React.ReactNode = null
  if (c.type === 'text') inner = <TextBox body={c} ctx={ctx} />
  else if (c.type === 'shape') inner = <ShapeBox c={c} ctx={ctx} />
  else if (c.type === 'image') {
    inner = <Figure palette={ctx.palette} url={c.src || undefined} crop={c.crop} radius={c.radius ?? 0} style={{ position: 'absolute', inset: 0 }} />
  }
  return inner ? <div style={box}>{inner}</div> : null
}

function fromBlueprint(bp: (input: BlueprintInput) => SlideComponent[]): React.FC<LayoutProps> {
  function Layout(props: LayoutProps): React.JSX.Element {
    const { theme, draft, images, locale } = props
    const p = resolvePalette(theme, 'content')
    const ctx: ResolveCtx = { theme, palette: p }
    const comps = bp({ pageKey: 'p', draft, images, locale })
    return (
      <Canvas palette={p} theme={theme}>
        {comps.map((c) => <Piece key={c.id} c={c} ctx={ctx} />)}
      </Canvas>
    )
  }
  return Layout
}

/* ---------------- 五个版式（槽位照规格表·relation＝新版式标记） ---------------- */

/** 卡片·中心大卡（总分）：items[0]＝中心总述（content 槽）·items[1..8]＝四周数据小卡 */
export const contentMosaicLayout: LayoutEntry = {
  meta: {
    id: 'content-mosaic',
    pageType: 'content',
    relation: 'total',
    group: 'v2',
    slots: makeSlotTable({ text: { title: 1, content: 1, item: MOSAIC_CAP, itemTitle: MOSAIC_CAP }, image: { pageFigure: 1 } }),
  },
  Component: fromBlueprint(contentMosaic),
}

/** 卡片·箭头串联（递进 4 段·末卡强调色实底） */
export const contentCardsFlowLayout: LayoutEntry = {
  meta: {
    id: 'content-cards-flow',
    pageType: 'content',
    relation: 'progressive',
    group: 'v2',
    slots: makeSlotTable({ text: { title: 1, item: 4, itemTitle: 4, itemNumber: 4 }, image: {} }),
  },
  Component: fromBlueprint(contentCardsFlow),
}

/** 全图·毛玻璃（一段话）：满版图走 background 槽（16:9 裁切·pageFigure 是竖向侧栏比例会裁歪） */
export const contentFullbleedGlassLayout: LayoutEntry = {
  meta: {
    id: 'content-fullbleed-glass',
    pageType: 'content',
    relation: 'paragraph',
    group: 'v2',
    slots: makeSlotTable({ text: { title: 1, content: 1, item: 1, itemTitle: 1 }, image: { background: 1 } }),
  },
  Component: fromBlueprint(contentFullbleedGlass),
}

/** 全图·一句话：标题拆 2–5 个错落大字框·items[0]＝落款（小标题＋副标） */
export const contentFullbleedQuoteLayout: LayoutEntry = {
  meta: {
    id: 'content-fullbleed-quote',
    pageType: 'content',
    relation: 'quote',
    group: 'v2',
    slots: makeSlotTable({ text: { title: 1, subtitle: 1, item: 1 }, image: { background: 1 } }),
  },
  Component: fromBlueprint(contentFullbleedQuote),
}

/** 全图·三栏（并列）：上方留天空·下方 3 张半透明卡 */
export const contentFullbleedColsLayout: LayoutEntry = {
  meta: {
    id: 'content-fullbleed-cols',
    pageType: 'content',
    relation: 'parallel',
    group: 'v2',
    slots: makeSlotTable({ text: { title: 1, item: 3, itemTitle: 3 }, image: { background: 1 } }),
  },
  Component: fromBlueprint(contentFullbleedCols),
}
