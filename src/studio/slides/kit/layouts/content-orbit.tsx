/**
 * slide-kit · 内容版式 · 环绕类 ×4（「环绕」类版式）
 *   content-orbit       总分 1 带 5–8：中心圆总述＋外圈细线＋分点绕圈均布
 *   content-orbit-loop  循环 3–6：外环切成 N 段首尾相接的箭头弧（燕尾箭头环）
 *   content-orbit-side  总分 3–5：大同心圆偏左半出画·分点只排右侧弧上
 *   content-orbit-dual  对比 8–14：两个中心圆（前 2 条）各被一圈小标签泡泡环绕（其余条目对半分）
 * 几何与组件蓝图同一份（components/blueprints-orbit.ts planOrbit）⇒ 旧式 React 版式与组件版框位一致。
 * meta.relation＝新版式标记：现行 pickLayout／自动分页跳过（只由关系／手动换版式选到）。
 */

import * as React from 'react'
import type { LayoutEntry, LayoutProps } from '../types'
import { makeSlotTable } from '../types'
import { fontStack, resolvePalette } from '../themes'
import { resolveColor, resolveCtx, type ResolveCtx } from '../components/resolve'
import { ORBIT_CAPS, planOrbit, type OrbitLayoutId, type OrbitPrim, type OrbitTextStyle } from '../components/blueprints-orbit'
import { Canvas } from './shared'

const fx = (n: number) => Math.round(n * 100) / 100

/** 文字（与组件渲染 TextBodyView 同一套样式：flex 竖排对齐＋单段多行截断） */
function TextIn(props: { content: string; st: OrbitTextStyle; ctx: ResolveCtx }): React.JSX.Element {
  const { content, st, ctx } = props
  const fam = st.font === 'theme:heading' ? ctx.theme.fontPair.heading : ctx.theme.fontPair.body
  return (
    <div
      style={{
        position: 'absolute', inset: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
        justifyContent: st.valign === 'middle' ? 'center' : st.valign === 'bottom' ? 'flex-end' : 'flex-start',
        fontFamily: fontStack(fam), fontSize: st.size, color: resolveColor(st.color, ctx, ctx.palette.text),
        fontWeight: st.bold ? 700 : 400, lineHeight: st.lineHeight, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', overflow: 'visible',
      }}
    >
      <div style={{ margin: 0, textAlign: st.align === 'distribute' ? 'justify' : st.align, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: st.maxLines, overflow: 'hidden' }}>
        {content || '​'}
      </div>
    </div>
  )
}

function Prim(props: { p: OrbitPrim; ctx: ResolveCtx }): React.JSX.Element {
  const { p, ctx } = props
  if (p.k === 'line') {
    const dx = p.x2 - p.x1, dy = p.y2 - p.y1
    const len = Math.max(1, Math.hypot(dx, dy))
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI
    return (
      <div style={{ position: 'absolute', left: (p.x1 + p.x2) / 2 - len / 2, top: (p.y1 + p.y2) / 2 - 1, width: len, height: 2, transform: `rotate(${fx(deg)}deg)` }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${len} 2`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <line x1={0} y1={1} x2={len} y2={1} stroke={resolveColor(p.color, ctx)} strokeWidth={p.width} />
        </svg>
      </div>
    )
  }
  const b = p.box
  const pos: React.CSSProperties = { position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h }
  if (p.k === 'text') {
    return <div style={pos}><TextIn content={p.content} st={p.st} ctx={ctx} /></div>
  }
  if (p.k === 'arc') {
    const rx = b.w / 2, ry = b.h / 2
    const sweep0 = ((p.end - p.start) % 360 + 360) % 360
    const sweep = sweep0 === 0 ? 360 : sweep0
    const e = p.start + Math.min(359.9, sweep)
    const at = (deg: number) => [rx + rx * Math.cos((deg * Math.PI) / 180), ry + ry * Math.sin((deg * Math.PI) / 180)] as const
    const [x0, y0] = at(p.start), [x1, y1] = at(e)
    const color = resolveColor(p.color, ctx, ctx.palette.text)
    // 终点箭头：与组件渲染 arrowHead 同一画法（尖在端点·朝切线方向）
    const ang = Math.atan2(ry * Math.cos((e * Math.PI) / 180), -rx * Math.sin((e * Math.PI) / 180))
    const L = Math.max(8, p.width * 4), Wd = Math.max(5, p.width * 2.5)
    const bx = x1 - L * Math.cos(ang), by = y1 - L * Math.sin(ang)
    const nx = -Math.sin(ang) * Wd, ny = Math.cos(ang) * Wd
    return (
      <div style={{ ...pos, ...(p.opacity !== undefined ? { opacity: p.opacity } : {}) }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${b.w} ${b.h}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <path d={`M${fx(x0)},${fx(y0)} A${fx(rx)} ${fx(ry)} 0 ${sweep > 180 ? 1 : 0} 1 ${fx(x1)},${fx(y1)}`} fill="none" stroke={color} strokeWidth={p.width} strokeLinecap="round" />
          {p.arrow ? <polygon points={`${fx(x1)},${fx(y1)} ${fx(bx + nx)},${fx(by + ny)} ${fx(bx - nx)},${fx(by - ny)}`} fill={color} /> : null}
        </svg>
      </div>
    )
  }
  // ellipse／roundRect
  const radius = p.k === 'ellipse' ? '50%' : p.radius
  const opacity = p.k === 'ellipse' && p.opacity !== undefined ? p.opacity : undefined
  return (
    <div style={{ ...pos, ...(opacity !== undefined ? { opacity } : {}) }}>
      {p.fill ? <div style={{ position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden', background: resolveColor(p.fill, ctx) }} /> : null}
      {p.stroke ? <div style={{ position: 'absolute', inset: 0, boxSizing: 'border-box', border: `${p.stroke.width}px solid ${resolveColor(p.stroke.color, ctx)}`, borderRadius: radius }} /> : null}
      {p.k === 'ellipse' && p.text ? <TextIn content={p.text.content} st={p.text.st} ctx={ctx} /> : null}
    </div>
  )
}

function orbitComponent(id: OrbitLayoutId): React.FC<LayoutProps> {
  function ContentOrbitLayout(props: LayoutProps): React.JSX.Element {
    const { theme } = props
    const p = resolvePalette(theme, 'content')
    const ctx = resolveCtx(theme, 'content')
    const prims = planOrbit(id, props.draft)
    return (
      <Canvas palette={p} theme={theme}>
        {prims.map((q) => <Prim key={q.key} p={q} ctx={ctx} />)}
      </Canvas>
    )
  }
  ContentOrbitLayout.displayName = `Layout(${id})`
  return ContentOrbitLayout
}

export const contentOrbit: LayoutEntry = {
  meta: {
    id: 'content-orbit',
    pageType: 'content',
    slots: makeSlotTable({ text: { title: 1, content: 1, item: 8, itemTitle: 8, itemNumber: 8 }, image: {} }),
    relation: 'total',
    group: 'v2',
    itemRange: Object.freeze(ORBIT_CAPS['content-orbit'].range),
  },
  Component: orbitComponent('content-orbit'),
}

export const contentOrbitLoop: LayoutEntry = {
  meta: {
    id: 'content-orbit-loop',
    pageType: 'content',
    slots: makeSlotTable({ text: { title: 1, content: 1, item: 6, itemTitle: 6, itemNumber: 6 }, image: {} }),
    relation: 'loop',
    group: 'v2',
    itemRange: Object.freeze(ORBIT_CAPS['content-orbit-loop'].range),
  },
  Component: orbitComponent('content-orbit-loop'),
}

export const contentOrbitSide: LayoutEntry = {
  meta: {
    id: 'content-orbit-side',
    pageType: 'content',
    slots: makeSlotTable({ text: { title: 1, content: 1, item: 5, itemTitle: 5, itemNumber: 5 }, image: {} }),
    relation: 'total',
    group: 'v2',
    itemRange: Object.freeze(ORBIT_CAPS['content-orbit-side'].range),
  },
  Component: orbitComponent('content-orbit-side'),
}

/** 双中心：item 容量 14＝前 2 条中心＋12 个泡泡（规格「itemTitle 2·item 6–12」按条目序折进同一 items） */
export const contentOrbitDual: LayoutEntry = {
  meta: {
    id: 'content-orbit-dual',
    pageType: 'content',
    slots: makeSlotTable({ text: { title: 1, item: 14, itemTitle: 14 }, image: {} }),
    relation: 'parallel',
    group: 'v2',
    itemRange: Object.freeze(ORBIT_CAPS['content-orbit-dual'].range),
  },
  Component: orbitComponent('content-orbit-dual'),
}
