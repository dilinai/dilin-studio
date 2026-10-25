/**
 * slide-kit · 封面版式 ×3
 * adapted from presenton (Apache-2.0)：
 *   cover-split ← swift/split_cover_layout_2459 · standard/split_cover_layout_7212
 *   cover-stage ← modern/balanced_cover_layout_8282（改全幅舞台式）
 *   cover-frame ← 自研（台湾职场向·细框居中）
 * 改造：坐标系 1000×562.5、契约槽位、中文排版、去强调线。
 */

import * as React from 'react'
import type { LayoutEntry, LayoutProps } from '../types'
import { makeSlotTable, resolveSlotImage } from '../types'
import { resolvePalette } from '../themes'
import { Canvas, Dot, Figure, bodyStyle, clampStyle, cropInsetStyle, headingStyle, isRenderableCrop, optText, textOr } from './shared'

/** 唯一取值点：脏 deck_data 防御——title/subtitle 非字符串统一挡掉。 */
function coverDraft(props: LayoutProps): { title: string; subtitle?: string } {
  if (props.draft.type !== 'cover') return { title: '' }
  return { title: textOr(props.draft.title), subtitle: optText(props.draft.subtitle) }
}

/* ---------------- cover-split：左文右图 ---------------- */

function CoverSplit(props: LayoutProps): React.JSX.Element {
  const { theme, images } = props
  const { title, subtitle } = coverDraft(props)
  const fig = resolveSlotImage(images?.pageFigure)
  const p = resolvePalette(theme, 'cover')
  return (
    <Canvas palette={p} theme={theme}>
      <div style={{ display: 'flex', height: '100%', padding: 64, gap: 56, boxSizing: 'border-box' }}>
        <div style={{ flex: '1 1 52%', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <Dot palette={p} size={12} />
            <Dot palette={p} size={12} />
            <Dot palette={p} size={12} />
          </div>
          <h1 style={{ ...headingStyle(theme, p, 46), ...clampStyle(4) }}>{title}</h1>
          {subtitle ? (
            <p style={{ ...bodyStyle(p, 19), ...clampStyle(2), marginTop: 22 }}>{subtitle}</p>
          ) : null}
        </div>
        <Figure
          palette={p}
          url={fig.url}
          crop={fig.crop}
          radius={20}
          style={{ flex: '0 0 38%', alignSelf: 'stretch', margin: '12px 0' }}
        />
      </div>
    </Canvas>
  )
}

export const coverSplit: LayoutEntry = {
  meta: {
    id: 'cover-split',
    desc: '封面·左標題右大圖',
    pageType: 'cover',
    slots: makeSlotTable({ text: { title: 1, subtitle: 1 }, image: { pageFigure: 1 } }),
  },
  Component: CoverSplit,
}

/* ---------------- cover-stage：全幅舞台 ---------------- */

function CoverStage(props: LayoutProps): React.JSX.Element {
  const { theme, images } = props
  const { title, subtitle } = coverDraft(props)
  const p = resolvePalette(theme, 'cover')
  const bg = resolveSlotImage(images?.background)
  return (
    <Canvas palette={p} theme={theme}>
      {bg.url ? (
        <>
          {/* crop 合法→inset 精确套用 S2 裁剪窗；缺/非法→原 cover 路径零回归 */}
          {isRenderableCrop(bg.crop) ? (
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bg.url} alt="" style={cropInsetStyle(bg.crop)} />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bg.url}
              alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
          <div style={{ position: 'absolute', inset: 0, background: p.bg, opacity: 0.82 }} />
        </>
      ) : (
        <>
          <div
            style={{
              position: 'absolute', right: -140, top: -140, width: 430, height: 430,
              borderRadius: '50%', background: p.accent, opacity: 0.12,
            }}
          />
          <div
            style={{
              position: 'absolute', right: 96, top: 118, width: 108, height: 108,
              borderRadius: '50%', background: p.accent, opacity: 0.3,
            }}
          />
        </>
      )}
      <div
        style={{
          position: 'absolute', inset: 0, padding: '0 80px', display: 'flex',
          flexDirection: 'column', justifyContent: 'center', maxWidth: 720, boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 30 }}>
          <Dot palette={p} size={14} />
          <span style={{ fontSize: 15, letterSpacing: 6, color: p.muted }}>PRESENTATION</span>
        </div>
        <h1 style={{ ...headingStyle(theme, p, 54), ...clampStyle(3) }}>{title}</h1>
        {subtitle ? (
          <p style={{ ...bodyStyle(p, 20), ...clampStyle(2), marginTop: 24 }}>{subtitle}</p>
        ) : null}
      </div>
    </Canvas>
  )
}

export const coverStage: LayoutEntry = {
  meta: {
    id: 'cover-stage',
    desc: '封面·大標題靠左（可鋪底圖）',
    pageType: 'cover',
    slots: makeSlotTable({ text: { title: 1, subtitle: 1 }, image: { background: 1 } }),
  },
  Component: CoverStage,
}

/* ---------------- cover-frame：细框居中（台湾职场向·自研） ---------------- */

function CoverFrame(props: LayoutProps): React.JSX.Element {
  const { theme } = props
  const { title, subtitle } = coverDraft(props)
  const p = resolvePalette(theme, 'cover')
  return (
    <Canvas palette={p} theme={theme}>
      <div
        style={{
          position: 'absolute', inset: 26, border: `1.5px solid ${p.border}`, borderRadius: 6,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '0 90px', textAlign: 'center', boxSizing: 'border-box',
        }}
      >
        <Dot palette={p} size={14} />
        <h1 style={{ ...headingStyle(theme, p, 44), ...clampStyle(3), marginTop: 30, maxWidth: 700 }}>
          {title}
        </h1>
        {subtitle ? (
          <p style={{ ...bodyStyle(p, 18), ...clampStyle(2), marginTop: 22, maxWidth: 560 }}>{subtitle}</p>
        ) : null}
        <div style={{ display: 'flex', gap: 10, marginTop: 34 }}>
          <Dot palette={p} size={8} />
          <Dot palette={p} size={8} />
          <Dot palette={p} size={8} />
        </div>
      </div>
    </Canvas>
  )
}

export const coverFrame: LayoutEntry = {
  meta: {
    id: 'cover-frame',
    desc: '封面·細框置中標題',
    pageType: 'cover',
    slots: makeSlotTable({ text: { title: 1, subtitle: 1 }, image: {} }),
  },
  Component: CoverFrame,
}
