/**
 * slide-kit · 结束版式 ×2
 * adapted from presenton (Apache-2.0)：
 *   end-center ← general/centered_quote_layout_7636（改致谢式）
 *   end-frame  ← 自研（细框呼应 cover-frame）
 * 改造：坐标系 1000×562.5、契约槽位、中文排版、去强调线。
 */

import * as React from 'react'
import type { LayoutEntry, LayoutProps } from '../types'
import { makeSlotTable } from '../types'
import { resolvePalette } from '../themes'
import { Canvas, Dot, bodyStyle, chromeText, headingStyle, clampStyle, optText, textOr } from './shared'

/** 唯一取值点：脏 deck_data 防御——title/subtitle 非字符串在这里
 *  统一挡掉（object title→''→落 locale 致谢默认语·object subtitle→undefined 不渲）。 */
function endDraft(props: LayoutProps): { title: string; subtitle?: string } {
  const d = props.draft.type === 'end' ? props.draft : undefined
  // 致谢默认语跟 locale 走：draft 自带 title 时以 draft 为准
  return { title: textOr(d?.title) || chromeText(props.locale).thanks, subtitle: optText(d?.subtitle) }
}

/* ---------------- end-center：居中致谢 ---------------- */

function EndCenter(props: LayoutProps): React.JSX.Element {
  const { theme } = props
  const { title, subtitle } = endDraft(props)
  const p = resolvePalette(theme, 'end')
  return (
    <Canvas palette={p} theme={theme}>
      <div
        style={{
          position: 'absolute', left: -130, top: -130, width: 380, height: 380,
          borderRadius: '50%', background: p.accent, opacity: 0.1,
        }}
      />
      <div
        style={{
          position: 'absolute', right: -90, bottom: -120, width: 300, height: 300,
          borderRadius: '50%', border: `2px solid ${p.border}`,
        }}
      />
      <div
        style={{
          height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', textAlign: 'center', padding: '0 110px', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', gap: 12 }}>
          <Dot palette={p} size={10} />
          <Dot palette={p} size={10} />
          <Dot palette={p} size={10} />
        </div>
        <h1 style={{ ...headingStyle(theme, p, 54), ...clampStyle(2), marginTop: 30, maxWidth: 720 }}>
          {title}
        </h1>
        {subtitle ? (
          <p style={{ ...bodyStyle(p, 18), ...clampStyle(2), marginTop: 22, maxWidth: 560 }}>{subtitle}</p>
        ) : null}
      </div>
    </Canvas>
  )
}

export const endCenter: LayoutEntry = {
  meta: {
    id: 'end-center',
    desc: '結尾·置中致謝',
    pageType: 'end',
    slots: makeSlotTable({ text: { title: 1, subtitle: 1 }, image: {} }),
  },
  Component: EndCenter,
}

/* ---------------- end-frame：细框致谢（呼应 cover-frame） ---------------- */

function EndFrame(props: LayoutProps): React.JSX.Element {
  const { theme } = props
  const { title, subtitle } = endDraft(props)
  const p = resolvePalette(theme, 'end')
  return (
    <Canvas palette={p} theme={theme}>
      <div
        style={{
          position: 'absolute', inset: 26, border: `1.5px solid ${p.border}`, borderRadius: 6,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', padding: '0 100px', boxSizing: 'border-box',
        }}
      >
        <Dot palette={p} size={14} />
        <h1 style={{ ...headingStyle(theme, p, 48), ...clampStyle(2), marginTop: 28, maxWidth: 680 }}>
          {title}
        </h1>
        {subtitle ? (
          <p style={{ ...bodyStyle(p, 17), ...clampStyle(2), marginTop: 20, maxWidth: 540 }}>{subtitle}</p>
        ) : null}
      </div>
    </Canvas>
  )
}

export const endFrame: LayoutEntry = {
  meta: {
    id: 'end-frame',
    desc: '結尾·細框致謝',
    pageType: 'end',
    slots: makeSlotTable({ text: { title: 1, subtitle: 1 }, image: {} }),
  },
  Component: EndFrame,
}
