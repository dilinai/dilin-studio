/**
 * slide-kit · 章节过渡版式 ×2
 * adapted from presenton (Apache-2.0)：
 *   transition-number ← general/centered_quote_layout_7636（改大编号+右文）
 *   transition-center ← 自研（居中编号章）
 * 改造：坐标系 1000×562.5、契约槽位、中文排版、去强调线。
 */

import * as React from 'react'
import type { LayoutEntry, LayoutProps } from '../types'
import { makeSlotTable } from '../types'
import { fontStack, resolvePalette } from '../themes'
import { Canvas, Dot, NumberBadge, bodyStyle, clampStyle, headingStyle, optText, textOr } from './shared'

/** 唯一取值点：脏 deck_data 防御——title/lead 非字符串、partNo 非
 *  有限数统一挡掉（partNo→undefined 走 partLabel 的 ?? 0 缺省分支）。 */
function transitionDraft(props: LayoutProps): { title: string; lead?: string; partNo?: number } {
  if (props.draft.type !== 'transition') return { title: '' }
  const rawPartNo = (props.draft as { partNo?: unknown }).partNo
  const partNo = typeof rawPartNo === 'number' && Number.isFinite(rawPartNo) && rawPartNo >= 0 ? rawPartNo : undefined
  return { title: textOr(props.draft.title), lead: optText(props.draft.lead), partNo }
}

function partLabel(partNo?: number): string {
  return String((partNo ?? 0) + 1).padStart(2, '0')
}

/* ---------------- transition-number：左巨号右文 ---------------- */

function TransitionNumber(props: LayoutProps): React.JSX.Element {
  const { theme } = props
  const { title, lead, partNo } = transitionDraft(props)
  const p = resolvePalette(theme, 'transition')
  return (
    <Canvas palette={p} theme={theme}>
      <div
        style={{
          position: 'absolute', left: -30, bottom: -60, width: 380, height: 380,
          borderRadius: '50%', background: p.accent, opacity: 0.08,
        }}
      />
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', padding: '0 80px', gap: 64, boxSizing: 'border-box' }}>
        <div
          style={{
            fontFamily: fontStack(theme.fontPair.heading), fontWeight: 700, fontSize: 170,
            lineHeight: 1, color: p.accent, flexShrink: 0,
          }}
        >
          {partLabel(partNo)}
        </div>
        <div style={{ width: 2, alignSelf: 'stretch', margin: '150px 0', background: p.border }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <Dot palette={p} size={10} />
            <span style={{ fontSize: 14, letterSpacing: 5, color: p.muted }}>CHAPTER</span>
          </div>
          <h2 style={{ ...headingStyle(theme, p, 42), ...clampStyle(2) }}>{title}</h2>
          {lead ? (
            <p style={{ ...bodyStyle(p, 18), ...clampStyle(3), marginTop: 18, maxWidth: 520 }}>{lead}</p>
          ) : null}
        </div>
      </div>
    </Canvas>
  )
}

export const transitionNumber: LayoutEntry = {
  meta: {
    id: 'transition-number',
    desc: '章節頁·超大章號＋標題',
    pageType: 'transition',
    slots: makeSlotTable({ text: { title: 1, content: 1, partNumber: 1 }, image: {} }),
  },
  Component: TransitionNumber,
}

/* ---------------- transition-center：居中编号章 ---------------- */

function TransitionCenter(props: LayoutProps): React.JSX.Element {
  const { theme } = props
  const { title, lead, partNo } = transitionDraft(props)
  const p = resolvePalette(theme, 'transition')
  return (
    <Canvas palette={p} theme={theme}>
      <div
        style={{
          position: 'absolute', right: -110, top: -110, width: 320, height: 320,
          borderRadius: '50%', border: `2px solid ${p.border}`,
        }}
      />
      <div
        style={{
          height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '0 120px', textAlign: 'center', boxSizing: 'border-box',
        }}
      >
        <NumberBadge palette={p} label={partLabel(partNo)} size={56} fontSize={22} />
        <h2 style={{ ...headingStyle(theme, p, 44), ...clampStyle(2), marginTop: 30, maxWidth: 680 }}>
          {title}
        </h2>
        {lead ? (
          <p style={{ ...bodyStyle(p, 18), ...clampStyle(2), marginTop: 18, maxWidth: 560 }}>{lead}</p>
        ) : null}
      </div>
    </Canvas>
  )
}

export const transitionCenter: LayoutEntry = {
  meta: {
    id: 'transition-center',
    desc: '章節頁·置中章號圓章＋標題',
    pageType: 'transition',
    slots: makeSlotTable({ text: { title: 1, content: 1, partNumber: 1 }, image: {} }),
  },
  Component: TransitionCenter,
}
